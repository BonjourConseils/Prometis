import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { loadEnv, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { StockageService } from '../stockage/stockage.service';
import { LectureFacturesService, type Piece } from './lecture-factures.service';
import {
  MESSAGE_MAX_OCTETS,
  PIECES_MAX,
  adresseBoite,
  decider,
  genererJetonBoite,
  jetonDepuisAdresses,
  normaliserEmail,
  verdictAuthentification,
} from './emails-regles';

export type IssueMessage =
  | { statut: 'ignore'; raison: string }
  | { statut: 'doublon'; emailId: number }
  | { statut: 'ACCEPTE' | 'QUARANTAINE' | 'REJETE'; emailId: number; piecesAcceptees: number };

/**
 * La boîte e-mail de chaque promotion : les factures transférées ou envoyées
 * par les entreprises y arrivent, et suivent le même chemin que le dépôt.
 *
 * Deux sources de messages, un seul traitement : la relève IMAP de la boîte
 * catch-all du sous-domaine, et une route interne protégée par un secret
 * (diagnostic, tests).
 */
@Injectable()
export class EmailsEntrantsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailsEntrantsService.name);
  private readonly env: Env = loadEnv();
  private minuterie?: NodeJS.Timeout;
  private enCours = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly stockage: StockageService,
    private readonly lecture: LectureFacturesService,
  ) {}

  get domaine(): string | null {
    return this.env.FACTURES_EMAIL_DOMAINE?.trim().toLowerCase() || null;
  }

  private get releveConfiguree(): boolean {
    return !!(
      this.domaine &&
      this.env.EMAIL_ENTRANT_IMAP_HOTE &&
      this.env.EMAIL_ENTRANT_IMAP_UTILISATEUR &&
      this.env.EMAIL_ENTRANT_IMAP_MOT_DE_PASSE
    );
  }

  onModuleInit() {
    if (!this.releveConfiguree) return;
    this.minuterie = setInterval(
      () => void this.relever(),
      this.env.EMAIL_ENTRANT_INTERVALLE_S * 1000,
    );
    this.logger.log(`Relève IMAP toutes les ${this.env.EMAIL_ENTRANT_INTERVALLE_S} s.`);
  }

  onModuleDestroy() {
    if (this.minuterie) clearInterval(this.minuterie);
  }

  // ===================================================================
  //  La boîte d'une promotion
  // ===================================================================

  async boite(operationId: number) {
    const op = await this.db.run((tx) =>
      tx.operation.findUnique({
        where: { id: operationId },
        select: { nom: true, boiteFacturesJeton: true, boiteFacturesOuverte: true },
      }),
    );
    if (!op) throw new NotFoundException('Promotion introuvable.');
    return {
      disponible: this.domaine !== null,
      adresse:
        op.boiteFacturesJeton && this.domaine
          ? adresseBoite(op.nom, op.boiteFacturesJeton, this.domaine)
          : null,
      ouverte: op.boiteFacturesOuverte,
    };
  }

  /** Crée l'adresse, ou la renouvelle : l'ancienne cesse aussitôt de recevoir. */
  async renouveler(operationId: number) {
    if (!this.domaine) {
      throw new BadRequestException('La réception par e-mail n’est pas activée sur ce serveur.');
    }
    await this.db.run(async (tx) => {
      await tx.operation.update({
        where: { id: operationId },
        data: { boiteFacturesJeton: genererJetonBoite() },
      });
      await this.audit.enregistrer(tx, {
        action: 'operation.boite_factures_renouvelee',
        entite: 'Operation',
        entiteId: operationId,
      });
    });
    return this.boite(operationId);
  }

  async ouvrir(operationId: number, ouverte: boolean) {
    await this.db.run(async (tx) => {
      await tx.operation.update({
        where: { id: operationId },
        data: { boiteFacturesOuverte: ouverte },
      });
      await this.audit.enregistrer(tx, {
        action: ouverte
          ? 'operation.boite_factures_ouverte'
          : 'operation.boite_factures_restreinte',
        entite: 'Operation',
        entiteId: operationId,
      });
    });
    return this.boite(operationId);
  }

  async lister(operationId: number) {
    return this.db.run((tx) =>
      tx.emailEntrant.findMany({
        where: { operationId },
        select: {
          id: true,
          expediteur: true,
          sujet: true,
          recuLe: true,
          statut: true,
          motif: true,
          authentification: true,
          pieces: true,
          piecesAcceptees: true,
          traiteLe: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  // ===================================================================
  //  Traiter un message
  // ===================================================================

  async traiterMessage(brut: Buffer): Promise<IssueMessage> {
    if (!this.domaine) return { statut: 'ignore', raison: 'réception éteinte' };
    if (brut.length > MESSAGE_MAX_OCTETS)
      return { statut: 'ignore', raison: 'message trop volumineux' };

    const m = await simpleParser(brut);
    const adresses = [
      ...adressesDe(m.to),
      ...adressesDe(m.cc),
      ...entetes(m, 'delivered-to'),
      ...entetes(m, 'x-original-to'),
    ];
    const jeton = jetonDepuisAdresses(adresses, this.domaine);
    if (!jeton) return { statut: 'ignore', raison: 'aucune adresse de promotion' };

    const lignes = await this.prisma.$queryRaw<{ operation_id: number; societe_id: number }[]>`
      SELECT operation_id, societe_id FROM app.operation_de_boite_factures(${jeton})`;
    const cible = lignes[0];
    // Adresse renouvelée ou inventée : rien à qui rattacher le message.
    if (!cible) return { statut: 'ignore', raison: 'adresse inconnue ou renouvelée' };
    const { operation_id: operationId, societe_id: societeId } = cible;

    const expediteur = normaliserEmail(m.from?.value[0]?.address ?? '');
    const messageId = m.messageId ?? `sha256:${createHash('sha256').update(brut).digest('hex')}`;
    const authentification = verdictAuthentification(entetes(m, 'authentication-results')[0]);

    const deja = await this.db.runInTenant(societeId, (tx) =>
      tx.emailEntrant.findUnique({
        where: { societeId_messageId: { societeId, messageId } },
        select: { id: true },
      }),
    );
    if (deja) return { statut: 'doublon', emailId: deja.id };

    const { connus, ouverte, entrepriseExpeditrice } = await this.db.runInTenant(
      societeId,
      async (tx) => {
        const [entreprises, membres, op] = await Promise.all([
          tx.entreprise.findMany({
            where: { email: { not: null } },
            select: { id: true, email: true },
          }),
          tx.membership.findMany({
            where: { isActive: true },
            select: { compte: { select: { email: true } } },
          }),
          tx.operation.findUniqueOrThrow({
            where: { id: operationId },
            select: { boiteFacturesOuverte: true },
          }),
        ]);
        return {
          connus: new Set([
            ...entreprises.map((e) => normaliserEmail(e.email!)),
            ...membres.map((x) => normaliserEmail(x.compte.email)),
          ]),
          ouverte: op.boiteFacturesOuverte,
          entrepriseExpeditrice:
            entreprises.filter((e) => normaliserEmail(e.email!) === expediteur).length === 1
              ? entreprises.find((e) => normaliserEmail(e.email!) === expediteur)!.id
              : null,
        };
      },
    );

    const pieces = piecesDe(m);
    const decision = decider({ expediteur, connus, ouverte, authentification });
    const objet = await this.stockage.deposer({
      societeId,
      operationId,
      nomFichier: 'message.eml',
      contenu: brut,
    });

    const email = await this.db.runInTenant(societeId, async (tx) => {
      const e = await tx.emailEntrant.create({
        data: {
          societeId,
          operationId,
          messageId,
          expediteur: expediteur || '(inconnu)',
          sujet: m.subject?.slice(0, 300) ?? null,
          recuLe: m.date ?? new Date(),
          statut: decision.statut === 'ACCEPTE' && !pieces.length ? 'REJETE' : decision.statut,
          motif:
            decision.motif ??
            (pieces.length ? null : 'Aucune pièce jointe PDF ou image dans le message.'),
          authentification,
          brutCle: objet.cle,
          pieces: pieces.length,
        },
      });
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: `email_entrant.${e.statut.toLowerCase()}`,
        entite: 'EmailEntrant',
        entiteId: e.id,
        donnees: { operationId, expediteur: e.expediteur, pieces: pieces.length, authentification },
      });
      return e;
    });

    let piecesAcceptees = 0;
    if (email.statut === 'ACCEPTE') {
      piecesAcceptees = await this.verser(
        societeId,
        operationId,
        email.id,
        pieces,
        expediteur,
        undefined,
        // Le rattachement par l'expéditeur ne vaut que s'il est authentifié.
        authentification === 'ok' ? entrepriseExpeditrice : null,
      );
    } else if (email.statut === 'REJETE' && connus.has(expediteur)) {
      // Un expéditeur connu apprend pourquoi rien n'a été pris. Jamais un
      // inconnu : répondre à une adresse usurpée, c'est écrire à la victime.
      await this.repondre(expediteur, m.subject, [email.motif ?? 'Message refusé.']);
    }
    return {
      statut: email.statut as 'ACCEPTE' | 'QUARANTAINE' | 'REJETE',
      emailId: email.id,
      piecesAcceptees,
    };
  }

  /** Les pièces entrent par la même porte que le glisser-déposer. */
  private async verser(
    societeId: number,
    operationId: number,
    emailId: number,
    pieces: Piece[],
    expediteur: string | null,
    membershipId?: number,
    entrepriseId?: number | null,
  ): Promise<number> {
    const resultats = await this.lecture.recevoir(societeId, operationId, pieces, 'EMAIL', {
      membershipId,
      emailEntrant: String(emailId),
      entrepriseId,
    });
    const acceptees = resultats.filter((r) => r.statut !== 'refusee').length;
    await this.db.runInTenant(societeId, (tx) =>
      tx.emailEntrant.update({
        where: { id: emailId },
        data: { piecesAcceptees: acceptees },
      }),
    );
    const refus = resultats.filter((r) => r.statut === 'refusee');
    if (refus.length && expediteur) {
      await this.repondre(
        expediteur,
        null,
        refus.map((r) => `${r.fichier} : ${'raison' in r ? r.raison : 'refusée'}`),
      );
    }
    return acceptees;
  }

  private async repondre(a: string, sujet: string | null | undefined, lignes: string[]) {
    try {
      await this.mail.envoyer({
        to: a,
        subject: `Prometis — pièce non prise en compte${sujet ? ` : ${sujet.slice(0, 80)}` : ''}`,
        text:
          'Bonjour,\n\nVotre envoi a bien été reçu, mais une partie n’a pas pu être prise en compte :\n\n' +
          lignes.map((l) => `· ${l}`).join('\n') +
          '\n\nUne facture se transmet en PDF ou en image (JPEG, PNG), 25 Mo au plus par pièce.\n\n—\n' +
          'Message automatique de l’adresse de réception des factures. Répondre à ce message ne sert à rien : ' +
          'contactez votre interlocuteur habituel.',
      });
    } catch (e) {
      this.logger.error(`Réponse à ${a} impossible : ${String(e)}`);
    }
  }

  // ===================================================================
  //  Quarantaine
  // ===================================================================

  async liberer(operationId: number, emailId: number) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;
    const e = await this.db.run(async (tx) => {
      const e = await tx.emailEntrant.findFirst({ where: { id: emailId, operationId } });
      if (!e) throw new NotFoundException('Message introuvable.');
      if (e.statut !== 'QUARANTAINE')
        throw new BadRequestException('Ce message n’est pas en quarantaine.');
      await tx.emailEntrant.update({
        where: { id: emailId },
        data: { statut: 'ACCEPTE', traiteLe: new Date(), traiteParId: membershipId },
      });
      await this.audit.enregistrer(tx, {
        action: 'email_entrant.libere',
        entite: 'EmailEntrant',
        entiteId: emailId,
        donnees: { operationId, expediteur: e.expediteur, motif: e.motif },
      });
      return e;
    });
    if (!e.brutCle) return { acceptees: 0 };
    const m = await simpleParser(await this.stockage.lire(e.brutCle));
    const acceptees = await this.verser(
      societeId,
      operationId,
      emailId,
      piecesDe(m),
      null,
      membershipId,
    );
    return { acceptees };
  }

  async rejeter(operationId: number, emailId: number) {
    const membershipId = RequestContext.requireWorkspace().membershipId;
    return this.db.run(async (tx) => {
      const { count } = await tx.emailEntrant.updateMany({
        where: { id: emailId, operationId, statut: 'QUARANTAINE' },
        data: { statut: 'REJETE', traiteLe: new Date(), traiteParId: membershipId },
      });
      if (!count) throw new NotFoundException('Message introuvable ou déjà traité.');
      await this.audit.enregistrer(tx, {
        action: 'email_entrant.rejete',
        entite: 'EmailEntrant',
        entiteId: emailId,
      });
      return { rejete: true };
    });
  }

  // ===================================================================
  //  Relève IMAP
  // ===================================================================

  /**
   * Relève les messages non lus de la boîte catch-all. Un message traité est
   * marqué lu, qu'il ait été accepté, mis en quarantaine ou ignoré : la
   * trace est en base, la boîte n'est pas une file d'attente.
   */
  async relever(): Promise<number> {
    if (this.enCours || !this.releveConfiguree) return 0;
    this.enCours = true;
    const client = new ImapFlow({
      host: this.env.EMAIL_ENTRANT_IMAP_HOTE!,
      port: this.env.EMAIL_ENTRANT_IMAP_PORT,
      secure: true,
      auth: {
        user: this.env.EMAIL_ENTRANT_IMAP_UTILISATEUR!,
        pass: this.env.EMAIL_ENTRANT_IMAP_MOT_DE_PASSE!,
      },
      logger: false,
    });
    let traites = 0;
    try {
      await client.connect();
      const verrou = await client.getMailboxLock('INBOX');
      try {
        const nonLus = await client.search({ seen: false }, { uid: true });
        for (const uid of nonLus || []) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (msg && msg.source) {
            try {
              const issue = await this.traiterMessage(msg.source);
              if (issue.statut === 'ignore')
                this.logger.warn(`Message ${uid} ignoré : ${issue.raison}.`);
              traites++;
            } catch (e) {
              this.logger.error(`Message ${uid} : ${String(e)}`);
            }
          }
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
      } finally {
        verrou.release();
      }
      await client.logout();
    } catch (e) {
      this.logger.error(`Relève IMAP : ${String(e)}`);
    } finally {
      this.enCours = false;
    }
    return traites;
  }
}

function adressesDe(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]).flatMap((x) => x.value.map((v) => v.address ?? ''));
}

/**
 * Les valeurs d'un en-tête, dans l'ordre du message. Le premier
 * `Authentication-Results` est celui de NOTRE serveur de réception — les
 * suivants ont pu être écrits par n'importe qui en amont.
 */
function entetes(m: ParsedMail, nom: string): string[] {
  return m.headerLines
    .filter((h) => h.key === nom)
    .map((h) =>
      h.line
        .slice(h.line.indexOf(':') + 1)
        .replace(/\r?\n\s+/g, ' ')
        .trim(),
    );
}

/** Les pièces jointes du message, sans les images incorporées (logos, signatures). */
function piecesDe(m: ParsedMail): Piece[] {
  return m.attachments
    .filter((a) => a.contentDisposition !== 'inline' || a.contentType === 'application/pdf')
    .slice(0, PIECES_MAX)
    .map((a) => ({ nom: a.filename ?? 'piece-jointe', octets: a.content }));
}
