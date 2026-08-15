import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv, type Env } from '../config/env';
import { chiffrer, dechiffrer, empreinteCodeSecours } from './chiffrement';
import {
  genererCodesSecours,
  genererSecret,
  normaliserCodeSecours,
  uriOtpauth,
  verifierCode,
} from './totp';

export interface EtatMfa {
  actif: boolean;
  enrolementEnCours: boolean;
  codesSecoursRestants: number;
  activeDepuis: Date | null;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly env: Env = loadEnv();

  constructor(private readonly prisma: PrismaService) {}

  async etat(compteId: number): Promise<EtatMfa> {
    const compte = await this.prisma.compte.findUniqueOrThrow({
      where: { id: compteId },
      select: { totpSecret: true, totpActiveAt: true, codesSecours: true },
    });
    return {
      actif: compte.totpActiveAt !== null,
      enrolementEnCours: compte.totpSecret !== null && compte.totpActiveAt === null,
      codesSecoursRestants: compte.codesSecours.length,
      activeDepuis: compte.totpActiveAt,
    };
  }

  /**
   * Première étape de l'enrôlement : produit un secret et l'URI à scanner.
   *
   * Le secret est enregistré **sans être activé**. Tant que l'utilisateur n'a
   * pas prouvé qu'il peut produire un code, la connexion reste à un facteur :
   * un enrôlement interrompu — QR affiché, application jamais configurée —
   * enfermerait sinon le compte dehors.
   *
   * Recommencer écrase le secret précédent. C'est voulu : quelqu'un qui refait
   * l'opération a perdu la première tentative.
   */
  async commencerEnrolement(compteId: number): Promise<{ secret: string; uri: string }> {
    const compte = await this.prisma.compte.findUniqueOrThrow({
      where: { id: compteId },
      select: { email: true, totpActiveAt: true },
    });
    if (compte.totpActiveAt) {
      throw new BadRequestException(
        'Le second facteur est déjà actif sur ce compte. Le désactiver avant de le réenrôler.',
      );
    }

    const secret = genererSecret();
    await this.prisma.compte.update({
      where: { id: compteId },
      data: { totpSecret: chiffrer(secret, this.env.MFA_ENCRYPTION_KEY), codesSecours: [] },
    });

    return {
      secret,
      uri: uriOtpauth(secret, { compte: compte.email, emetteur: this.env.MFA_ISSUER }),
    };
  }

  /**
   * Confirme l'enrôlement et rend les codes de secours.
   *
   * Ils sont affichés **une seule fois** — seules leurs empreintes sont
   * conservées. Les redonner sur demande reviendrait à les stocker en clair.
   */
  async activer(compteId: number, code: string): Promise<{ codesSecours: string[] }> {
    const compte = await this.prisma.compte.findUniqueOrThrow({
      where: { id: compteId },
      select: { totpSecret: true, totpActiveAt: true },
    });
    if (compte.totpActiveAt) {
      throw new BadRequestException('Le second facteur est déjà actif.');
    }
    if (!compte.totpSecret) {
      throw new BadRequestException("Aucun enrôlement en cours. Commencer par l'étape précédente.");
    }

    const secret = dechiffrer(compte.totpSecret, this.env.MFA_ENCRYPTION_KEY);
    if (!verifierCode(secret, code)) {
      throw new BadRequestException(
        'Code incorrect. Vérifier que l’heure du téléphone est à jour, puis réessayer.',
      );
    }

    const codesSecours = genererCodesSecours();
    await this.prisma.compte.update({
      where: { id: compteId },
      data: {
        totpActiveAt: new Date(),
        codesSecours: codesSecours.map((c) => empreinteCodeSecours(normaliserCodeSecours(c))),
      },
    });

    this.logger.log(`Second facteur activé sur le compte ${compteId}.`);
    return { codesSecours };
  }

  /**
   * Désactive le second facteur, sur présentation d'un code valide.
   *
   * On exige le code, pas seulement la session : une session volée pourrait
   * sinon retirer la protection qu'elle vient de contourner.
   */
  async desactiver(compteId: number, code: string): Promise<{ desactive: true }> {
    const compte = await this.prisma.compte.findUniqueOrThrow({
      where: { id: compteId },
      select: { totpSecret: true, totpActiveAt: true, codesSecours: true },
    });
    if (!compte.totpActiveAt || !compte.totpSecret) {
      throw new BadRequestException("Le second facteur n'est pas actif sur ce compte.");
    }

    const accepte = await this.verifier(compteId, code, compte);
    if (!accepte) throw new BadRequestException('Code incorrect.');

    await this.prisma.compte.update({
      where: { id: compteId },
      data: { totpSecret: null, totpActiveAt: null, codesSecours: [] },
    });

    this.logger.warn(`Second facteur DÉSACTIVÉ sur le compte ${compteId}.`);
    return { desactive: true };
  }

  /** Vérifie un code à la connexion. Lève si le compte n'a pas de MFA actif. */
  async verifierPourConnexion(compteId: number, code: string): Promise<void> {
    const compte = await this.prisma.compte.findUniqueOrThrow({
      where: { id: compteId },
      select: { totpSecret: true, totpActiveAt: true, codesSecours: true },
    });
    if (!compte.totpActiveAt || !compte.totpSecret) {
      throw new UnauthorizedException("Aucun second facteur n'est attendu pour ce compte.");
    }
    if (!(await this.verifier(compteId, code, compte))) {
      // Message unique : distinguer « code expiré » de « code faux » ne
      // renseigne que celui qui essaie.
      throw new UnauthorizedException('Code de vérification invalide.');
    }
  }

  /**
   * Accepte soit un code TOTP, soit un code de secours.
   *
   * Un code de secours est **retiré** de la liste dès qu'il sert : c'est ce
   * retrait qui fait l'usage unique, sans table supplémentaire.
   */
  private async verifier(
    compteId: number,
    code: string,
    compte: { totpSecret: string | null; codesSecours: string[] },
  ): Promise<boolean> {
    if (compte.totpSecret) {
      const secret = dechiffrer(compte.totpSecret, this.env.MFA_ENCRYPTION_KEY);
      if (verifierCode(secret, code)) return true;
    }

    const empreinte = empreinteCodeSecours(normaliserCodeSecours(code));
    if (!compte.codesSecours.includes(empreinte)) return false;

    await this.prisma.compte.update({
      where: { id: compteId },
      data: { codesSecours: compte.codesSecours.filter((c) => c !== empreinte) },
    });
    this.logger.warn(
      `Connexion par code de secours sur le compte ${compteId} — ` +
        `${compte.codesSecours.length - 1} restant(s).`,
    );
    return true;
  }
}
