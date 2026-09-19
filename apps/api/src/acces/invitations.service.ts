import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  AccessModule,
  ActeurType,
  OperationAccessLevel,
  UtilisateurRole,
} from '@prisma/client';
import { loadEnv, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PasswordService } from '../auth/password.service';
import { LimiteursService } from '../securite/limiteurs.service';

/** Quatorze jours : le temps d'un aller-retour avec un bureau d'architecte. */
export const VALIDITE_INVITATION_MS = 14 * 24 * 60 * 60 * 1000;
export const MOT_DE_PASSE_MIN = 12;

export interface AccesInvite {
  operationId: number;
  accessLevel: OperationAccessLevel;
  modules: AccessModule[];
}

export interface DonneesInvitation {
  email: string;
  prenom?: string | null;
  nom?: string | null;
  /** Employé de la société, ou intervenant externe (architecte, DT…). */
  externe: boolean;
  role?: UtilisateurRole;
  fonction?: string | null;
  acteurType?: ActeurType | null;
  societeNom?: string | null;
  acces: AccesInvite[];
  directionTravauxDe: number[];
}

export function empreinte(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

export const LIBELLE_ROLE: Record<UtilisateurRole, string> = {
  OWNER: 'propriétaire',
  ADMIN: 'administrateur',
  CHEF_PROJET: 'chef de projet',
  ECONOMISTE: 'économiste de la construction',
  COMPTABILITE: 'comptabilité',
  COMMERCIAL: 'commercial',
  LECTURE_SEULE: 'lecture seule',
  EXTERNE: 'intervenant externe',
};

export const LIBELLE_ACTEUR: Partial<Record<ActeurType, string>> = {
  ARCHITECTE: 'architecte',
  DIRECTION_TRAVAUX: 'direction des travaux',
  INGENIEUR: 'ingénieur',
  BUREAU_TECHNIQUE: 'bureau technique',
  ENTREPRISE_GENERALE: 'entreprise générale',
  PILOTE: 'pilote',
  AUTRE: 'intervenant',
};

const REFUS = 'Cette invitation n’est pas ou plus valable. Demandez-en une nouvelle.';

/**
 * Faire entrer quelqu'un dans la société : un employé, ou un intervenant
 * externe — architecte, direction des travaux — limité aux opérations qu'on
 * lui ouvre.
 *
 * Le lien est une capacité transmissible (skill `securite-saas`, § 5) : usage
 * unique, quatorze jours, révocable, stocké en empreinte, et chaque geste est
 * journalisé. Le rôle accordé est celui choisi par l'administrateur ; un
 * externe est toujours `EXTERNE`, borné par ses accès par opération.
 *
 * Une personne qui a déjà un compte Prometis — un architecte qui travaille
 * pour trois promoteurs — rejoint la société avec son mot de passe : un
 * compte, plusieurs espaces de travail.
 */
@Injectable()
export class InvitationsService {
  private readonly env: Env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly motsDePasse: PasswordService,
    private readonly limiteurs: LimiteursService,
  ) {}

  private lien(jeton: string) {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/invitation/${jeton}`;
  }

  // ===================================================================
  //  Côté société
  // ===================================================================

  async lister() {
    return this.db.run((tx) =>
      tx.invitationMembre.findMany({
        where: { accepteeLe: null, revoqueeLe: null },
        select: {
          id: true,
          email: true,
          prenom: true,
          nom: true,
          role: true,
          fonction: true,
          acteurType: true,
          societeNom: true,
          acces: true,
          directionTravauxDe: true,
          expireLe: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async inviter(d: DonneesInvitation) {
    const workspace = RequestContext.requireWorkspace();
    const email = d.email.trim().toLowerCase();
    const role: UtilisateurRole = d.externe ? 'EXTERNE' : (d.role ?? 'LECTURE_SEULE');

    if (d.externe && (!d.acteurType || !d.societeNom?.trim())) {
      throw new BadRequestException(
        'Un intervenant externe se présente : à quel titre, et pour quelle société.',
      );
    }
    if (!d.externe && role === 'EXTERNE') {
      throw new BadRequestException('Un employé reçoit un rôle interne.');
    }
    if (role === 'OWNER' && workspace.role !== 'OWNER') {
      throw new ForbiddenException('Seul un propriétaire peut en inviter un autre.');
    }
    if (d.externe && !d.acces.length) {
      throw new BadRequestException(
        'Un intervenant externe ne voit que les promotions qu’on lui ouvre : choisissez-en au moins une.',
      );
    }
    for (const opId of d.directionTravauxDe) {
      const a = d.acces.find((x) => x.operationId === opId);
      if (!a || a.accessLevel === 'READ_ONLY') {
        throw new BadRequestException(
          'La direction des travaux vise les factures : elle a besoin d’un accès « opérer » au moins sur la promotion.',
        );
      }
      if (a.modules.length && !a.modules.includes('FACTURES')) {
        throw new BadRequestException(
          'La direction des travaux doit avoir accès aux factures de la promotion.',
        );
      }
    }

    const jeton = randomBytes(32).toString('base64url');
    const societe = await this.db.run(async (tx) => {
      const ops = [...new Set([...d.acces.map((a) => a.operationId), ...d.directionTravauxDe])];
      if (ops.length) {
        const trouvees = await tx.operation.count({ where: { id: { in: ops } } });
        if (trouvees !== ops.length) throw new NotFoundException('Promotion introuvable.');
      }
      const deja = await tx.membership.findFirst({
        where: { compte: { email } },
        select: { id: true, isActive: true },
      });
      if (deja) {
        throw new ConflictException(
          deja.isActive
            ? 'Cette personne est déjà membre de la société : ouvrez-lui les promotions depuis sa ligne.'
            : 'Cette personne est membre, mais désactivée : réactivez-la depuis sa ligne.',
        );
      }
      // Une invitation en attente pour la même adresse est remplacée : un seul
      // lien valable à la fois.
      await tx.invitationMembre.updateMany({
        where: { email, accepteeLe: null, revoqueeLe: null },
        data: { revoqueeLe: new Date() },
      });
      const inv = await tx.invitationMembre.create({
        data: {
          societeId: workspace.societeId,
          email,
          prenom: d.prenom?.trim() || null,
          nom: d.nom?.trim() || null,
          role,
          fonction: d.fonction?.trim() || null,
          acteurType: d.externe ? d.acteurType! : null,
          societeNom: d.externe ? d.societeNom!.trim() : null,
          acces: d.acces as never,
          directionTravauxDe: d.directionTravauxDe,
          tokenHash: empreinte(jeton),
          expireLe: new Date(Date.now() + VALIDITE_INVITATION_MS),
          creeParId: workspace.membershipId,
        },
      });
      await this.audit.enregistrer(tx, {
        action: 'invitation_membre.creee',
        entite: 'InvitationMembre',
        entiteId: inv.id,
        donnees: {
          email,
          role,
          acteurType: inv.acteurType,
          operations: d.acces.map((a) => `${a.operationId}:${a.accessLevel}`),
          directionTravauxDe: d.directionTravauxDe,
        },
      });
      const s = await tx.societe.findUniqueOrThrow({
        where: { id: workspace.societeId },
        select: { raisonSociale: true },
      });
      const nomsOps = await tx.operation.findMany({
        where: { id: { in: d.acces.map((a) => a.operationId) } },
        select: { nom: true },
      });
      return { raisonSociale: s.raisonSociale, operations: nomsOps.map((o) => o.nom), inv };
    });

    await this.envoyer(email, societe.raisonSociale, role, d, societe.operations, jeton);
    return { id: societe.inv.id, email, expireLe: societe.inv.expireLe };
  }

  private async envoyer(
    email: string,
    societe: string,
    role: UtilisateurRole,
    d: { prenom?: string | null; acteurType?: ActeurType | null; fonction?: string | null },
    operations: string[],
    jeton: string,
  ) {
    const titre = d.acteurType
      ? (LIBELLE_ACTEUR[d.acteurType] ?? 'intervenant')
      : (d.fonction ?? LIBELLE_ROLE[role]);
    await this.mail.envoyer({
      to: email,
      subject: `${societe} vous invite dans Prometis`,
      text:
        `${d.prenom ? `Bonjour ${d.prenom},` : 'Bonjour,'}\n\n` +
        `${societe} vous invite à rejoindre son espace Prometis, en tant que ${titre}.\n` +
        (operations.length ? `Promotions ouvertes : ${operations.join(', ')}.\n` : '') +
        `\nPour accepter :\n${this.lien(jeton)}\n\n` +
        'Ce lien vous est personnel, vaut quatorze jours et ne sert qu’une fois. ' +
        'Si vous avez déjà un compte Prometis, vous rejoindrez cet espace avec votre mot de passe habituel.\n\n' +
        '—\nVous recevez ce message parce qu’un administrateur de cette société a saisi votre adresse. ' +
        'Si vous ne connaissez pas cette société, ignorez-le : rien n’est créé sans votre acceptation.',
    });
  }

  /** Un nouveau lien ; l'ancien cesse de fonctionner. */
  async renvoyer(invitationId: number) {
    const jeton = randomBytes(32).toString('base64url');
    const { inv, societe, operations } = await this.db.run(async (tx) => {
      const inv = await tx.invitationMembre.findFirst({
        where: { id: invitationId, accepteeLe: null, revoqueeLe: null },
      });
      if (!inv) throw new NotFoundException('Invitation introuvable ou déjà traitée.');
      const maj = await tx.invitationMembre.update({
        where: { id: invitationId },
        data: {
          tokenHash: empreinte(jeton),
          expireLe: new Date(Date.now() + VALIDITE_INVITATION_MS),
        },
      });
      await this.audit.enregistrer(tx, {
        action: 'invitation_membre.renvoyee',
        entite: 'InvitationMembre',
        entiteId: invitationId,
        donnees: { email: inv.email },
      });
      const s = await tx.societe.findUniqueOrThrow({
        where: { id: inv.societeId },
        select: { raisonSociale: true },
      });
      const ops = await tx.operation.findMany({
        where: { id: { in: (inv.acces as unknown as AccesInvite[]).map((a) => a.operationId) } },
        select: { nom: true },
      });
      return { inv: maj, societe: s.raisonSociale, operations: ops.map((o) => o.nom) };
    });
    await this.envoyer(inv.email, societe, inv.role, inv, operations, jeton);
    return { renvoyee: true, expireLe: inv.expireLe };
  }

  async revoquer(invitationId: number) {
    return this.db.run(async (tx) => {
      const { count } = await tx.invitationMembre.updateMany({
        where: { id: invitationId, accepteeLe: null, revoqueeLe: null },
        data: { revoqueeLe: new Date() },
      });
      if (!count) throw new NotFoundException('Invitation introuvable ou déjà traitée.');
      await this.audit.enregistrer(tx, {
        action: 'invitation_membre.revoquee',
        entite: 'InvitationMembre',
        entiteId: invitationId,
      });
      return { revoquee: true };
    });
  }

  // ===================================================================
  //  Côté invité — sans session
  // ===================================================================

  private async resoudre(jeton: string) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(jeton)) throw new NotFoundException(REFUS);
    const lignes = await this.prisma.$queryRaw<{ invitation_id: number; societe_id: number }[]>`
      SELECT invitation_id, societe_id FROM app.invitation_membre_de_jeton(${empreinte(jeton)})`;
    const l = lignes[0];
    if (!l) throw new NotFoundException(REFUS);
    const inv = await this.db.runInTenant(l.societe_id, (tx) =>
      tx.invitationMembre.findUnique({
        where: { id: l.invitation_id },
        include: { societe: { select: { raisonSociale: true } } },
      }),
    );
    if (!inv || inv.accepteeLe || inv.revoqueeLe || inv.expireLe <= new Date()) {
      throw new NotFoundException(REFUS);
    }
    return inv;
  }

  /** Ce que la page d'acceptation affiche. */
  async lire(jeton: string) {
    this.limiteurs.exiger(this.limiteurs.adresse.verifier(this.limiteurs.cleAdresse()));
    const inv = await this.resoudre(jeton);
    const compte = await this.prisma.compte.findUnique({
      where: { email: inv.email },
      select: { id: true },
    });
    const ops = await this.db.runInTenant(inv.societeId, (tx) =>
      tx.operation.findMany({
        where: { id: { in: (inv.acces as unknown as AccesInvite[]).map((a) => a.operationId) } },
        select: { nom: true },
      }),
    );
    return {
      societe: inv.societe.raisonSociale,
      email: inv.email,
      prenom: inv.prenom,
      nom: inv.nom,
      titre: inv.acteurType
        ? (LIBELLE_ACTEUR[inv.acteurType] ?? 'intervenant')
        : (inv.fonction ?? LIBELLE_ROLE[inv.role]),
      societeNom: inv.societeNom,
      operations: ops.map((o) => o.nom),
      directionTravaux: inv.directionTravauxDe.length > 0,
      compteExistant: compte !== null,
      expireLe: inv.expireLe,
    };
  }

  /**
   * Accepter. Nouveau venu : il choisit son mot de passe. Compte existant :
   * il prouve qu'il en est le titulaire avec son mot de passe. Dans les deux
   * cas, la connexion se fait ensuite normalement — second facteur compris.
   */
  async accepter(
    jeton: string,
    d: {
      motDePasse: string;
      prenom?: string | null;
      nom?: string | null;
      prisConnaissance: boolean;
    },
  ) {
    this.limiteurs.exiger(this.limiteurs.adresse.verifier(this.limiteurs.cleAdresse()));
    const inv = await this.resoudre(jeton);
    if (!d.prisConnaissance) {
      throw new BadRequestException(
        'Confirmez que vous rejoignez cet espace, et ce que cela implique.',
      );
    }
    const cle = `invitation:${inv.id}`;
    this.limiteurs.exiger(this.limiteurs.compte.verifier(cle));

    let compte = await this.prisma.compte.findUnique({ where: { email: inv.email } });
    const compteCree = compte === null;
    if (compte) {
      const ok =
        compte.isActive && (await this.motsDePasse.verify(compte.passwordHash, d.motDePasse));
      if (!ok) {
        this.limiteurs.compte.echec(cle);
        this.limiteurs.adresse.echec(this.limiteurs.cleAdresse());
        throw new UnauthorizedException('Mot de passe incorrect pour ce compte Prometis.');
      }
    } else {
      if (d.motDePasse.length < MOT_DE_PASSE_MIN) {
        throw new BadRequestException(
          `Choisissez un mot de passe d’au moins ${MOT_DE_PASSE_MIN} caractères.`,
        );
      }
      if (!d.prenom?.trim() || !d.nom?.trim()) {
        throw new BadRequestException('Indiquez votre prénom et votre nom.');
      }
      compte = await this.prisma.compte.create({
        data: {
          email: inv.email,
          passwordHash: await this.motsDePasse.hash(d.motDePasse),
          prenom: d.prenom.trim(),
          nom: d.nom.trim(),
        },
      });
    }
    const compteId = compte.id;

    await this.db.runInTenant(inv.societeId, async (tx) => {
      // Relu dans la transaction : deux clics simultanés n'acceptent qu'une fois.
      const marquee = await tx.invitationMembre.updateMany({
        where: { id: inv.id, accepteeLe: null, revoqueeLe: null },
        data: { accepteeLe: new Date(), compteId },
      });
      if (!marquee.count) throw new NotFoundException(REFUS);

      const existe = await tx.membership.findFirst({ where: { compteId } });
      if (existe) throw new ConflictException('Vous êtes déjà membre de cette société.');

      let acteurId: number | null = null;
      if (inv.acteurType) {
        const acteur =
          (await tx.acteur.findFirst({
            where: { email: inv.email, type: inv.acteurType },
            select: { id: true },
          })) ??
          (await tx.acteur.create({
            data: {
              societeId: inv.societeId,
              type: inv.acteurType,
              societeNom: inv.societeNom,
              prenom: compte!.prenom,
              nom: compte!.nom,
              email: inv.email,
            },
            select: { id: true },
          }));
        acteurId = acteur.id;
      }

      const membership = await tx.membership.create({
        data: {
          compteId,
          societeId: inv.societeId,
          role: inv.role,
          fonction: inv.fonction,
          acteurId,
        },
      });

      const acces = inv.acces as unknown as AccesInvite[];
      const existantes = new Set(
        (
          await tx.operation.findMany({
            where: { id: { in: acces.map((a) => a.operationId) } },
            select: { id: true },
          })
        ).map((o) => o.id),
      );
      for (const a of acces.filter((x) => existantes.has(x.operationId))) {
        await tx.operationAccess.create({
          data: {
            operationId: a.operationId,
            membershipId: membership.id,
            accessLevel: a.accessLevel,
            modules: a.modules,
            grantedById: inv.creeParId,
          },
        });
      }
      for (const opId of inv.directionTravauxDe.filter((id) => existantes.has(id))) {
        await tx.operation.update({
          where: { id: opId },
          data: { directionTravauxId: membership.id },
        });
      }

      await this.audit.enregistrerAutomatique(tx, inv.societeId, {
        action: 'invitation_membre.acceptee',
        entite: 'Membership',
        entiteId: membership.id,
        donnees: {
          invitationId: inv.id,
          email: inv.email,
          role: inv.role,
          compteCree,
        },
      });
    });

    this.limiteurs.compte.reinitialiser(cle);
    return { acceptee: true, email: inv.email };
  }

  // ===================================================================
  //  Direction des travaux
  // ===================================================================

  /**
   * Nomme la direction des travaux d'une opération — ou la retire (`null`).
   * Elle doit être membre, avoir accès à l'opération et à ses factures.
   */
  async nommerDirectionTravaux(operationId: number, membershipId: number | null) {
    return this.db.run(async (tx) => {
      if (membershipId !== null) {
        const acces = await tx.operationAccess.findUnique({
          where: { operationId_membershipId: { operationId, membershipId } },
          select: { accessLevel: true, modules: true },
        });
        const m = await tx.membership.findUnique({
          where: { id: membershipId },
          select: { role: true, isActive: true },
        });
        const admin = m?.role === 'OWNER' || m?.role === 'ADMIN';
        if (!m?.isActive || (!admin && !acces)) {
          throw new BadRequestException('Cette personne n’a pas accès à la promotion.');
        }
        if (
          acces &&
          (acces.accessLevel === 'READ_ONLY' ||
            (acces.modules.length > 0 && !acces.modules.includes('FACTURES')))
        ) {
          throw new BadRequestException(
            'La direction des travaux vise les factures : il lui faut un accès « opérer » aux factures de la promotion.',
          );
        }
      }
      const op = await tx.operation.update({
        where: { id: operationId },
        data: { directionTravauxId: membershipId },
        select: { id: true, directionTravauxId: true },
      });
      await this.audit.enregistrer(tx, {
        action: membershipId
          ? 'operation.direction_travaux_nommee'
          : 'operation.direction_travaux_retiree',
        entite: 'Operation',
        entiteId: operationId,
        donnees: { membershipId },
      });
      return op;
    });
  }
}
