import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { loadEnv, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { StockageService } from '../stockage/stockage.service';
import { LimiteursService } from '../securite/limiteurs.service';
import { typeAccepte } from '../securite/type-fichier';
import {
  CODE_ESSAIS_MAX,
  CODE_VALIDITE_MS,
  SESSION_CONSULTATION,
  depotOuvert,
  empreinteCode,
  empreinteJeton,
  genererCode,
  jetonBienForme,
  masquerEmail,
  memeEmpreinte,
  secretSession,
} from './consultation-regles';
import { accuseReception, code as courrielCode } from './consultation-emails';

interface SessionEntreprise {
  /** Invitation. */
  inv: number;
  /** Société (tenant) — relue en base à chaque appel, jamais crue seule. */
  sid: number;
  /** Empreinte du lien : une session ne sert que sur son propre lien. */
  jh: string;
  typ: 'consultation';
}

export interface DepotOffre {
  montant: Prisma.Decimal;
  remisePct: Prisma.Decimal | null;
  note: string | null;
  lignes: { type: 'OPTION' | 'VARIANTE'; libelle: string; montant: Prisma.Decimal }[];
}

const REFUS = 'Ce lien n’est pas ou plus valable. Demandez une nouvelle invitation au promoteur.';

/**
 * L'espace entreprise : ce qu'un soumissionnaire voit et fait, sans compte
 * Prometis.
 *
 * Deux facteurs, jamais un seul : le **lien** personnel (32 octets, stocké en
 * empreinte seulement) et un **code** envoyé à l'adresse de l'invitation. Un
 * lien transféré ou oublié dans une boîte partagée n'ouvre rien sans la boîte
 * elle-même. La session qui en résulte est courte, signée avec un secret
 * distinct de celui des comptes, et liée à ce seul lien.
 *
 * Tout se lit dans le tenant de la soumission, sous RLS, et se borne à
 * l'invitation : une entreprise ne voit ni les autres invités, ni leurs
 * offres, ni qui a posé une question.
 */
@Injectable()
export class EspaceEntrepriseService {
  private readonly env: Env = loadEnv();
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly stockage: StockageService,
    private readonly limiteurs: LimiteursService,
    private readonly jwt: JwtService,
  ) {
    this.secret = secretSession(this.env.JWT_SECRET);
  }

  // ===================================================================
  //  Accès
  // ===================================================================

  private async resoudre(jeton: string) {
    if (!jetonBienForme(jeton)) throw new NotFoundException(REFUS);
    const hash = empreinteJeton(jeton);
    const lignes = await this.prisma.$queryRaw<
      { invitation_id: number; soumission_id: number; societe_id: number }[]
    >`SELECT invitation_id, soumission_id, societe_id FROM app.invitation_de_jeton(${hash})`;
    const l = lignes[0];
    if (!l) throw new NotFoundException(REFUS);
    const inv = await this.db.runInTenant(l.societe_id, (tx) =>
      tx.soumissionInvitation.findUnique({ where: { id: l.invitation_id } }),
    );
    if (!inv || inv.revoqueeLe || !inv.email) throw new NotFoundException(REFUS);
    return { inv, societeId: l.societe_id, hash };
  }

  /** Envoie un code à l'adresse de l'invitation — et à elle seule. */
  async demanderCode(jeton: string) {
    this.limiteurs.exiger(this.limiteurs.adresse.verifier(this.limiteurs.cleAdresse()));
    const { inv, societeId } = await this.resoudre(jeton);
    const cle = `consultation:${inv.id}`;
    this.limiteurs.exiger(this.limiteurs.mfa.verifier(cle));
    // Chaque demande compte : sans cela, on inonderait la boîte de
    // l'entreprise de codes, ou on les essaierait un par un.
    this.limiteurs.mfa.echec(cle);

    const code = genererCode();
    const s = await this.db.runInTenant(societeId, async (tx) => {
      await tx.soumissionInvitation.update({
        where: { id: inv.id },
        data: {
          codeHash: empreinteCode(code, inv.id, this.secret),
          codeExpireLe: new Date(Date.now() + CODE_VALIDITE_MS),
          codeEssais: 0,
        },
      });
      return tx.soumission.findUniqueOrThrow({
        where: { id: inv.soumissionId },
        select: {
          intitule: true,
          operation: { select: { societe: { select: { raisonSociale: true } } } },
        },
      });
    });
    await this.mail.envoyer({
      to: inv.email!,
      ...courrielCode({ promoteur: s.operation.societe.raisonSociale, intitule: s.intitule, code }),
    });
    return { envoye: true, email: masquerEmail(inv.email!) };
  }

  /** Échange le code contre une session courte, liée à ce lien. */
  async ouvrirSession(jeton: string, code: string) {
    this.limiteurs.exiger(this.limiteurs.adresse.verifier(this.limiteurs.cleAdresse()));
    const { inv, societeId, hash } = await this.resoudre(jeton);
    const valide =
      /^\d{6}$/.test(code) &&
      !!inv.codeHash &&
      !!inv.codeExpireLe &&
      inv.codeExpireLe > new Date() &&
      inv.codeEssais < CODE_ESSAIS_MAX &&
      memeEmpreinte(empreinteCode(code, inv.id, this.secret), inv.codeHash);

    await this.db.runInTenant(societeId, async (tx) => {
      await tx.soumissionInvitation.update({
        where: { id: inv.id },
        // Réussi : le code est brûlé. Raté : un essai de plus, et au
        // cinquième il ne vaut plus rien.
        data: valide
          ? { codeHash: null, codeExpireLe: null, codeEssais: 0, consulteeLe: new Date() }
          : { codeEssais: { increment: 1 } },
      });
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: valide ? 'consultation.ouverte' : 'consultation.code_refuse',
        entite: 'SoumissionInvitation',
        entiteId: inv.id,
        donnees: { soumissionId: inv.soumissionId },
      });
    });
    if (!valide) {
      this.limiteurs.adresse.echec(this.limiteurs.cleAdresse());
      throw new UnauthorizedException('Code incorrect ou expiré. Demandez-en un nouveau.');
    }
    const session = this.jwt.sign(
      { inv: inv.id, sid: societeId, jh: hash, typ: 'consultation' } satisfies SessionEntreprise,
      { secret: this.secret, expiresIn: SESSION_CONSULTATION as never },
    );
    return { session };
  }

  /**
   * Lit la session, et vérifie qu'elle vaut pour ce lien, que l'invitation
   * n'a pas été révoquée depuis, et qu'elle appartient bien à la société
   * annoncée.
   */
  private async session(jeton: string, session: string | undefined) {
    if (!session) throw new UnauthorizedException('Session requise.');
    let p: SessionEntreprise;
    try {
      p = this.jwt.verify<SessionEntreprise>(session, { secret: this.secret });
    } catch {
      throw new UnauthorizedException('Session expirée. Demandez un nouveau code.');
    }
    if (p.typ !== 'consultation' || !jetonBienForme(jeton) || p.jh !== empreinteJeton(jeton)) {
      throw new UnauthorizedException('Session expirée. Demandez un nouveau code.');
    }
    const inv = await this.db.runInTenant(p.sid, (tx) =>
      tx.soumissionInvitation.findFirst({
        where: { id: p.inv, jetonHash: p.jh, revoqueeLe: null },
        include: {
          entreprise: { select: { nom: true } },
          soumission: {
            include: {
              operation: {
                select: { nom: true, commune: true, societe: { select: { raisonSociale: true } } },
              },
              cfcNode: { select: { code: true, libelle: true } },
            },
          },
        },
      }),
    );
    if (!inv) throw new UnauthorizedException('Cet accès a été retiré.');
    return { inv, societeId: p.sid };
  }

  // ===================================================================
  //  Lecture
  // ===================================================================

  async dossier(jeton: string, session: string | undefined) {
    const { inv, societeId } = await this.session(jeton, session);
    const s = inv.soumission;
    return this.db.runInTenant(societeId, async (tx) => {
      const [documents, questions, offre] = await Promise.all([
        tx.document.findMany({
          where: { soumissionId: s.id, offreId: null, visibiliteExterne: true, isCourant: true },
          select: { id: true, titre: true, fileName: true, fileSize: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        tx.questionSoumission.findMany({
          // Les réponses publiées, pour tous ; ses propres questions, pour soi.
          where: { soumissionId: s.id, OR: [{ publiee: true }, { invitationId: inv.id }] },
          select: {
            id: true,
            question: true,
            reponse: true,
            reponduLe: true,
            publiee: true,
            invitationId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        tx.offre.findFirst({
          where: { soumissionId: s.id, entrepriseId: inv.entrepriseId },
          include: {
            lignes: { orderBy: { id: 'asc' } },
            documents: { where: { isCourant: true }, select: { id: true, fileName: true } },
          },
        }),
      ]);
      return {
        entreprise: inv.entreprise.nom,
        promoteur: s.operation.societe.raisonSociale,
        operation: { nom: s.operation.nom, commune: s.operation.commune },
        soumission: {
          intitule: s.intitule,
          corpsMetier: s.corpsMetier,
          cfc: s.cfcNode,
          descriptif: s.descriptif,
          conditions: s.conditions,
          delaiExecution: s.delaiExecution,
          dateLimite: s.dateLimite,
          statut: s.statut,
          offresScellees: s.offresScellees,
        },
        depotOuvert: depotOuvert(s, inv),
        refuseLe: inv.refuseLe,
        documents,
        questions: questions.map(({ invitationId, ...q }) => ({
          ...q,
          mienne: invitationId === inv.id,
        })),
        offre: offre && {
          montant: offre.montant,
          remisePct: offre.remisePct,
          note: offre.note,
          dateReception: offre.dateReception,
          statut:
            ['RETENUE', 'ECARTEE'].includes(offre.statut) && s.statut === 'ADJUGEE'
              ? offre.statut
              : 'RECUE',
          lignes: offre.lignes.map((l) => ({
            type: l.type,
            libelle: l.libelle,
            montant: l.montant,
          })),
          documents: offre.documents,
        },
      };
    });
  }

  async document(jeton: string, session: string | undefined, documentId: number) {
    const { inv, societeId } = await this.session(jeton, session);
    const doc = await this.db.runInTenant(societeId, (tx) =>
      tx.document.findFirst({
        where: {
          id: documentId,
          isCourant: true,
          soumissionId: inv.soumissionId,
          // Le dossier diffusé, ou la pièce de sa propre offre — rien d'autre.
          OR: [
            { offreId: null, visibiliteExterne: true },
            { offre: { is: { entrepriseId: inv.entrepriseId } } },
          ],
        },
      }),
    );
    if (!doc) throw new NotFoundException('Document introuvable.');
    await this.db.runInTenant(societeId, (tx) =>
      this.audit.enregistrerAutomatique(tx, societeId, {
        action: 'consultation.document_telecharge',
        entite: 'Document',
        entiteId: doc.id,
        donnees: { invitationId: inv.id },
      }),
    );
    return { document: doc, contenu: await this.stockage.lire(doc.filePath) };
  }

  // ===================================================================
  //  Écriture — tant que le dépôt est ouvert
  // ===================================================================

  private exigerOuvert(inv: Awaited<ReturnType<EspaceEntrepriseService['session']>>['inv']) {
    if (!depotOuvert(inv.soumission, inv)) {
      throw new ForbiddenException(
        'La date limite est passée ou la consultation est close : plus rien ne se dépose.',
      );
    }
  }

  async poserQuestion(jeton: string, session: string | undefined, question: string) {
    const { inv, societeId } = await this.session(jeton, session);
    this.exigerOuvert(inv);
    return this.db.runInTenant(societeId, async (tx) => {
      const q = await tx.questionSoumission.create({
        data: { soumissionId: inv.soumissionId, invitationId: inv.id, question },
        select: { id: true, createdAt: true },
      });
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: 'consultation.question',
        entite: 'QuestionSoumission',
        entiteId: q.id,
        donnees: { soumissionId: inv.soumissionId, entreprise: inv.entreprise.nom },
      });
      return q;
    });
  }

  /**
   * Dépose — ou remplace — l'offre de l'entreprise. Le PDF est obligatoire :
   * c'est lui qui engage l'entreprise ; le montant saisi sert à comparer.
   */
  async deposerOffre(
    jeton: string,
    session: string | undefined,
    donnees: DepotOffre,
    fichier: { nomOriginal: string; contenu: Buffer } | undefined,
  ) {
    const { inv, societeId } = await this.session(jeton, session);
    this.exigerOuvert(inv);
    if (!fichier) throw new BadRequestException('Joignez le PDF signé de votre offre.');
    const controle = typeAccepte(fichier.contenu, fichier.nomOriginal, 'document');
    if (!controle.ok) throw new BadRequestException(controle.raison);
    if (controle.type.mime !== 'application/pdf') {
      throw new BadRequestException('L’offre se dépose en PDF.');
    }
    if (donnees.lignes.filter((l) => l.type === 'VARIANTE').length > 10) {
      throw new BadRequestException('Dix variantes au plus.');
    }

    const operationId = inv.soumission.operationId;
    const objet = await this.stockage.deposer({
      societeId,
      operationId,
      nomFichier: fichier.nomOriginal,
      contenu: fichier.contenu,
    });
    const deposeeLe = new Date();

    const offre = await this.db.runInTenant(societeId, async (tx: TenantDb) => {
      const existante = await tx.offre.findFirst({
        where: { soumissionId: inv.soumissionId, entrepriseId: inv.entrepriseId },
      });
      const valeurs = {
        montant: donnees.montant,
        remisePct: donnees.remisePct,
        note: donnees.note,
        statut: 'RECUE' as const,
        dateReception: deposeeLe,
        source: 'PORTAIL',
      };
      const offre = existante
        ? await tx.offre.update({ where: { id: existante.id }, data: valeurs })
        : await tx.offre.create({
            data: { soumissionId: inv.soumissionId, entrepriseId: inv.entrepriseId, ...valeurs },
          });
      await tx.offreLigne.deleteMany({ where: { offreId: offre.id } });
      if (donnees.lignes.length) {
        await tx.offreLigne.createMany({
          data: donnees.lignes.map((l) => ({ offreId: offre.id, ...l })),
        });
      }
      // La pièce précédente reste, en version antérieure : ce qui a été
      // déposé une fois ne s'efface pas.
      await tx.document.updateMany({
        where: { offreId: offre.id, isCourant: true },
        data: { isCourant: false },
      });
      await tx.document.create({
        data: {
          societeId,
          operationId,
          soumissionId: inv.soumissionId,
          offreId: offre.id,
          titre: `Offre — ${inv.entreprise.nom}`,
          categorie: 'DEVIS',
          fileName: fichier.nomOriginal,
          filePath: objet.cle,
          mimeType: 'application/pdf',
          fileSize: objet.taille,
          version: 1,
          isCourant: true,
        },
      });
      await tx.soumissionInvitation.update({ where: { id: inv.id }, data: { aRepondu: true } });
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: existante ? 'consultation.offre_remplacee' : 'consultation.offre_deposee',
        entite: 'Offre',
        entiteId: offre.id,
        // Pas de montant dans le journal : l'offre est scellée, le journal
        // ne doit pas l'ouvrir avant l'heure.
        donnees: { soumissionId: inv.soumissionId, entreprise: inv.entreprise.nom },
      });
      return offre;
    });

    await this.mail.envoyer({
      to: inv.email!,
      ...accuseReception({
        promoteur: inv.soumission.operation.societe.raisonSociale,
        intitule: inv.soumission.intitule,
        deposeeLe,
        dateLimite: inv.soumission.offresScellees ? inv.soumission.dateLimite : null,
      }),
    });
    return { deposee: true, offreId: offre.id, deposeeLe };
  }

  async decliner(jeton: string, session: string | undefined, motif: string | null) {
    const { inv, societeId } = await this.session(jeton, session);
    this.exigerOuvert(inv);
    await this.db.runInTenant(societeId, async (tx) => {
      await tx.soumissionInvitation.update({
        where: { id: inv.id },
        data: { refuseLe: new Date(), motifRefus: motif },
      });
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: 'consultation.declinee',
        entite: 'SoumissionInvitation',
        entiteId: inv.id,
        donnees: { soumissionId: inv.soumissionId, entreprise: inv.entreprise.nom },
      });
    });
    return { declinee: true };
  }
}
