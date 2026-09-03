import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PasserelleService } from '../passerelle/passerelle.service';
import { GedService } from '../ged/ged.service';
import { QrFactureService } from './qr-facture.pdf';
import { LettreAcquereurService, montantSuisse } from './lettre-acquereur.pdf';
import { calculerMontantAppel, etatAppel, numeroAppel, STATUTS_ENGAGES } from './calculs';
import { formaterReferenceQR, genererReferenceQR } from './qr-reference';

const ZERO = new Prisma.Decimal(0);

/** Coordonnées de la société émettrice, telles que les documents les portent. */
interface SocieteEmettrice {
  raisonSociale: string;
  iban: string | null;
  adresse: string | null;
  codePostal: string | null;
  localite: string | null;
}

/** Une personne du dossier, destinataire de l'appel. */
interface Destinataire {
  nom: string;
  email: string | null;
  adresse: string | null;
  npa: string | null;
  localite: string | null;
  role: string;
  quotePart: string | null;
}

/** Un appel créé dans la transaction, prêt pour la mise en documents. */
interface AppelCree {
  id: number;
  reservationId: number;
  montant: Prisma.Decimal;
  lot: string;
  /** Le dossier entier : la créance est solidaire, tous reçoivent. */
  destinataires: Destinataire[];
  qrReference: string;
  dateEcheance: Date;
}

/**
 * Le nom qu'on écrit sur un courrier.
 *
 * Une société n'a ni prénom ni nom de famille : c'est sa raison sociale qui
 * fait foi. L'ordre compte — préférer « Jean Dupont » à « Dupont SA » quand
 * les deux sont renseignés donnerait un courrier adressé au représentant
 * plutôt qu'à l'acquéreur réel.
 */
function nomAffiche(personne: {
  nom: string | null;
  prenom: string | null;
  raisonSociale: string | null;
}): string {
  const physique = `${personne.prenom ?? ''} ${personne.nom ?? ''}`.trim();
  if (personne.raisonSociale && !physique) return personne.raisonSociale;
  return physique || (personne.raisonSociale ?? '');
}

/** Délai de paiement par défaut d'un appel de fonds, en jours. */
const DELAI_PAIEMENT_JOURS = 30;

export interface ResultatDeclenchement {
  etape: { id: number; libelle: string; pourcentage: string | null };
  jalonDeSuivi: boolean;
  appelsCrees: number;
  appelsDejaExistants: number;
  montantTotal: string;
  envois: { reussis: number; echecs: { appelId: number; raison: string }[] };
  /** `kolabimo` quand le jalon vient du webhook, `prometis` sinon. */
  declenchePar: 'kolabimo' | 'prometis';
}

@Injectable()
export class AppelsDeFondsService {
  private readonly logger = new Logger(AppelsDeFondsService.name);

  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => PasserelleService))
    private readonly passerelle: PasserelleService,
    private readonly qrFacture: QrFactureService,
    private readonly lettre: LettreAcquereurService,
    private readonly ged: GedService,
  ) {}

  // ===================================================================
  //  Le moteur
  // ===================================================================

  /**
   * Marque un jalon terminé et en tire les appels de fonds.
   *
   * C'est **le** geste métier du produit côté vente. Trois propriétés le
   * gouvernent :
   *
   *   1. **Idempotence.** L'unicité `(reservationId, etapeId)` est en base ;
   *      rejouer un déclenchement ne crée rien de nouveau. Un promoteur qui
   *      reclique, ou un webhook rejoué, ne facture pas deux fois.
   *   2. **Un jalon sans pourcentage n'appelle rien.** C'est un suivi de
   *      chantier, pas une échéance de paiement.
   *   3. **Les e-mails partent après le commit.** Envoyer dans la transaction
   *      enverrait des appels de fonds pour des lignes qu'un échec ultérieur
   *      annulerait — et un e-mail parti ne se rattrape pas.
   */
  async declencherEtape(
    operationId: number,
    etapeId: number,
    options: {
      dateCompletion?: Date;
      envoyer?: boolean;
      /** Tenant explicite : un webhook n'a pas d'espace de travail. */
      societeId?: number;
      /**
       * Déclenché par la passerelle et non par une personne. Change deux
       * choses : la trace d'audit n'invente pas d'auteur humain, et la garde
       * « Kolabimo est maître » ne s'applique pas — c'est justement lui qui
       * appelle.
       */
      automatique?: boolean;
    } = {},
  ): Promise<ResultatDeclenchement> {
    const dateCompletion = options.dateCompletion ?? new Date();
    const envoyer = options.envoyer ?? true;
    const automatique = options.automatique ?? false;

    const societeId = options.societeId ?? RequestContext.requireSocieteId();

    const { etape, crees, dejaExistants, montantTotal } = await this.db.runInTenant(
      societeId,
      async (tx) => {
        const etape = await tx.echeancierEtape.findFirst({
          where: { id: etapeId, operationId },
          select: {
            id: true,
            libelle: true,
            pourcentage: true,
            statut: true,
            ordre: true,
            kolabimoEtapeId: true,
          },
        });
        if (!etape)
          throw new NotFoundException(`Étape ${etapeId} introuvable dans cette opération.`);

        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: operationId },
          select: { kolabimoPromotionId: true, nom: true },
        });

        // Depuis le 2 septembre 2026, **Kolabimo est maître de la fin de
        // jalon** : le promoteur la marque là où elle informe les agences.
        // Deux endroits pour déclencher des factures, c'est le piège qu'on
        // évite — pas une question de confort d'interface.
        if (!automatique && operation.kolabimoPromotionId !== null) {
          throw new ConflictException(
            `« ${operation.nom} » est reliée à Kolabimo : la fin d'étape s'y marque, ` +
              `et Prometis en tire les appels de fonds. Marquez le jalon dans Kolabimo.`,
          );
        }

        await tx.echeancierEtape.update({
          where: { id: etapeId },
          data: {
            statut: 'COMPLETED',
            dateCompletion,
            // Reçu de Kolabimo : l'horodatage dit désormais « aligné sur le
            // maître », et non plus « poussé vers lui ».
            ...(automatique ? { syncedAt: new Date() } : {}),
          },
        });

        if (etape.pourcentage === null) {
          await this.tracer(tx, societeId, automatique, {
            action: 'echeancier_etape.completee',
            entite: 'EcheancierEtape',
            entiteId: etapeId,
            donnees: { operationId, libelle: etape.libelle, appelsDeFonds: 0, jalonDeSuivi: true },
          });
          // Rien à pousser vers Kolabimo : il tient l'avancement lui-même,
          // c'est de là que l'information nous vient.
          return { etape, crees: [], dejaExistants: 0, montantTotal: ZERO };
        }

        const reservations = await tx.reservation.findMany({
          where: { operationId, statut: { in: STATUTS_ENGAGES } },
          include: {
            lot: { select: { reference: true } },
            // Le dossier entier, pas seulement le contact principal : une
            // indivision ou un couple reçoit à plusieurs, et la créance est
            // solidaire.
            acquereurs: {
              orderBy: { ordre: 'asc' },
              include: { acquereur: true },
            },
          },
        });

        const existants = await tx.appelDeFonds.findMany({
          where: { etapeId },
          select: { reservationId: true },
        });
        const dejaAppelees = new Set(existants.map((a) => a.reservationId));

        const crees: AppelCree[] = [];
        let montantTotal = ZERO;

        const dateEcheance = new Date(dateCompletion);
        dateEcheance.setDate(dateEcheance.getDate() + DELAI_PAIEMENT_JOURS);

        for (const reservation of reservations) {
          if (dejaAppelees.has(reservation.id)) continue;
          const appel = await this.creerAppel(tx, {
            operationId,
            etapeId,
            pourcentage: etape.pourcentage,
            reservation,
            dateEmission: dateCompletion,
            dateEcheance,
          });
          if (!appel) continue;
          montantTotal = montantTotal.plus(appel.montant);
          crees.push(appel);
        }

        await this.tracer(tx, societeId, automatique, {
          action: 'echeancier_etape.completee',
          entite: 'EcheancierEtape',
          entiteId: etapeId,
          donnees: {
            operationId,
            libelle: etape.libelle,
            pourcentage: etape.pourcentage,
            appelsCrees: crees.length,
            appelsDejaExistants: dejaAppelees.size,
            montantTotal,
            source: automatique ? 'kolabimo' : 'prometis',
          },
        });

        return { etape, crees, dejaExistants: dejaAppelees.size, montantTotal };
      },
    );

    // --- Après le commit seulement -------------------------------------
    const envois = envoyer
      ? await this.envoyerAppels(societeId, operationId, etape.libelle, dateCompletion, crees)
      : { reussis: 0, echecs: [] };

    return {
      etape: {
        id: etape.id,
        libelle: etape.libelle,
        pourcentage: etape.pourcentage?.toString() ?? null,
      },
      jalonDeSuivi: etape.pourcentage === null,
      appelsCrees: crees.length,
      appelsDejaExistants: dejaExistants,
      montantTotal: montantTotal.toFixed(2),
      envois,
      declenchePar: automatique ? 'kolabimo' : 'prometis',
    };
  }

  // ===================================================================
  //  Rattrapage — le premier appel d'un lot vendu en cours de chantier
  // ===================================================================

  /**
   * Les étapes déjà terminées qu'une réservation n'a pas encore payées.
   *
   * Le cas est celui d'un lot vendu alors que le chantier est engagé : la
   * dalle est coulée, le gros œuvre est fini, et l'acquéreur arrive. Trois
   * jalons sont derrière lui.
   *
   * **Rien n'est appelé d'office.** Certaines de ces tranches figurent dans
   * l'acte et ont été réglées à la signature, chez le notaire ; d'autres ont
   * été négociées, ou reportées. Les appeler automatiquement, c'est réclamer
   * à un acquéreur ce qu'il vient de payer — la faute qu'on n'a pas droit de
   * commettre une fois. Le promoteur choisit donc, ligne par ligne.
   */
  async etapesRattrapables(operationId: number, reservationId: number) {
    const { reservation, etapes, dejaAppelees } = await this.db.run(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, operationId },
        select: {
          id: true,
          statut: true,
          prixTotalActe: true,
          dateSignatureActe: true,
          lot: { select: { reference: true } },
          acquereurs: {
            orderBy: { ordre: 'asc' },
            select: {
              role: true,
              quotePart: true,
              acquereur: { select: { nom: true, prenom: true, raisonSociale: true } },
            },
          },
        },
      });
      if (!reservation) return { reservation: null, etapes: [], dejaAppelees: new Set<number>() };

      const etapes = await tx.echeancierEtape.findMany({
        where: { operationId, statut: 'COMPLETED', pourcentage: { not: null } },
        orderBy: { ordre: 'asc' },
        select: {
          id: true,
          ordre: true,
          libelle: true,
          pourcentage: true,
          dateCompletion: true,
        },
      });

      const appels = await tx.appelDeFonds.findMany({
        where: { reservationId },
        select: { etapeId: true },
      });

      return { reservation, etapes, dejaAppelees: new Set(appels.map((a) => a.etapeId)) };
    });

    if (!reservation) {
      throw new NotFoundException(`Réservation ${reservationId} introuvable dans cette opération.`);
    }

    const lignes = etapes.map((etape) => ({
      etapeId: etape.id,
      ordre: etape.ordre,
      libelle: etape.libelle,
      pourcentage: etape.pourcentage!.toString(),
      dateCompletion: etape.dateCompletion,
      dejaAppelee: dejaAppelees.has(etape.id),
      montant: reservation.prixTotalActe
        ? calculerMontantAppel(etape.pourcentage!, reservation.prixTotalActe).toFixed(2)
        : null,
    }));

    const aChoisir = lignes.filter((l) => !l.dejaAppelee);

    return {
      reservation: {
        id: reservation.id,
        statut: reservation.statut,
        lot: reservation.lot.reference,
        prixTotalActe: reservation.prixTotalActe?.toFixed(2) ?? null,
        dateSignatureActe: reservation.dateSignatureActe,
        acquereurs: reservation.acquereurs.map((l) => ({
          nom: nomAffiche(l.acquereur),
          role: l.role,
          quotePart: l.quotePart,
        })),
      },
      etapes: lignes,
      // Le total de ce qui reste à trancher — pas de ce qui sera appelé.
      montantAChoisir: aChoisir.reduce((total, l) => total.plus(l.montant ?? 0), ZERO).toFixed(2),
      enAttente: aChoisir.length,
    };
  }

  /**
   * Émet le premier appel d'un lot sur les étapes **choisies**.
   *
   * Idempotent par la même contrainte que partout ailleurs : l'unicité
   * `(réservation, étape)`. Une étape déjà appelée est signalée, pas
   * réémise — rejouer ce geste ne facture pas deux fois.
   */
  async rattraper(
    operationId: number,
    reservationId: number,
    etapeIds: number[],
    options: { envoyer?: boolean } = {},
  ) {
    const envoyer = options.envoyer ?? true;
    const societeId = RequestContext.requireSocieteId();
    const dateEmission = new Date();
    const dateEcheance = new Date(dateEmission);
    dateEcheance.setDate(dateEcheance.getDate() + DELAI_PAIEMENT_JOURS);

    const { crees, ignorees, libelles } = await this.db.run(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, operationId },
        include: {
          lot: { select: { reference: true } },
          acquereurs: { orderBy: { ordre: 'asc' }, include: { acquereur: true } },
        },
      });
      if (!reservation) {
        throw new NotFoundException(
          `Réservation ${reservationId} introuvable dans cette opération.`,
        );
      }
      if (!STATUTS_ENGAGES.includes(reservation.statut)) {
        throw new BadRequestException(
          `La réservation du lot ${reservation.lot.reference} n'est pas engagée ` +
            `(${reservation.statut}) : aucun appel de fonds ne lui est dû.`,
        );
      }

      const etapes = await tx.echeancierEtape.findMany({
        where: {
          id: { in: etapeIds },
          operationId,
          statut: 'COMPLETED',
          pourcentage: { not: null },
        },
        orderBy: { ordre: 'asc' },
        select: { id: true, libelle: true, pourcentage: true },
      });

      const introuvables = etapeIds.filter((id) => !etapes.some((e) => e.id === id));
      if (introuvables.length > 0) {
        throw new BadRequestException(
          `Étape(s) ${introuvables.join(', ')} : inconnues de cette opération, non terminées, ` +
            `ou sans pourcentage. Le rattrapage ne porte que sur des jalons de paiement clos.`,
        );
      }

      const existants = await tx.appelDeFonds.findMany({
        where: { reservationId, etapeId: { in: etapeIds } },
        select: { etapeId: true },
      });
      const dejaAppelees = new Set(existants.map((a) => a.etapeId));

      const crees: AppelCree[] = [];
      const ignorees: { etapeId: number; raison: string }[] = [];

      for (const etape of etapes) {
        if (dejaAppelees.has(etape.id)) {
          ignorees.push({ etapeId: etape.id, raison: 'Appel déjà émis pour cette étape.' });
          continue;
        }
        const appel = await this.creerAppel(tx, {
          operationId,
          etapeId: etape.id,
          pourcentage: etape.pourcentage!,
          reservation,
          dateEmission,
          dateEcheance,
        });
        if (!appel) {
          ignorees.push({
            etapeId: etape.id,
            raison: "Réservation sans prix total acte : pas d'assiette de calcul.",
          });
          continue;
        }
        crees.push(appel);
      }

      await this.audit.enregistrer(tx, {
        action: 'appel_de_fonds.rattrapage',
        entite: 'Reservation',
        entiteId: reservationId,
        donnees: {
          operationId,
          lot: reservation.lot.reference,
          etapesChoisies: etapeIds,
          appelsCrees: crees.length,
          ignorees,
          montantTotal: crees.reduce((t, a) => t.plus(a.montant), ZERO),
        },
      });

      return {
        crees,
        ignorees,
        libelles: new Map(etapes.map((e) => [e.id, e.libelle])),
      };
    });

    // Un envoi par étape : chaque appel porte son propre jalon, et donc sa
    // propre lettre. Les regrouper obligerait l'acquéreur à démêler quelle
    // tranche correspond à quoi.
    let reussis = 0;
    const echecs: { appelId: number; raison: string }[] = [];
    if (envoyer) {
      for (const appel of crees) {
        const etapeId = await this.db.run((tx) =>
          tx.appelDeFonds
            .findUniqueOrThrow({ where: { id: appel.id }, select: { etapeId: true } })
            .then((a) => a.etapeId),
        );
        const resultat = await this.envoyerAppels(
          societeId,
          operationId,
          libelles.get(etapeId) ?? 'Étape',
          dateEmission,
          [appel],
        );
        reussis += resultat.reussis;
        echecs.push(...resultat.echecs);
      }
    }

    return {
      appelsCrees: crees.length,
      ignorees,
      montantTotal: crees.reduce((t, a) => t.plus(a.montant), ZERO).toFixed(2),
      envois: { reussis, echecs },
    };
  }

  /**
   * Envoie les appels créés — **après le commit**, jamais dedans.
   *
   * Un e-mail parti ne se rattrape pas : l'envoyer dans la transaction ferait
   * partir des appels de fonds pour des lignes qu'un échec ultérieur
   * annulerait. Un échec d'envoi, à l'inverse, ne remet rien en cause : la
   * créance existe et reste due, l'écran de suivi permet de relancer.
   */
  private async envoyerAppels(
    societeId: number,
    operationId: number,
    etapeLibelle: string,
    dateEmission: Date,
    crees: AppelCree[],
  ): Promise<{ reussis: number; echecs: { appelId: number; raison: string }[] }> {
    const echecs: { appelId: number; raison: string }[] = [];
    let reussis = 0;
    if (crees.length === 0) return { reussis, echecs };

    const societe = await this.db.runInTenant(societeId, (tx) =>
      tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: {
          raisonSociale: true,
          iban: true,
          adresse: true,
          codePostal: true,
          localite: true,
        },
      }),
    );

    for (const appel of crees) {
      const adresses = appel.destinataires
        .map((d) => d.email)
        .filter((e): e is string => e !== null && e.trim() !== '');

      if (adresses.length === 0) {
        echecs.push({
          appelId: appel.id,
          raison:
            appel.destinataires.length === 0
              ? "Dossier sans acquéreur nominatif — l'identité arrive à FONDS_VERSES"
              : 'Aucun acquéreur du dossier n’a d’adresse e-mail',
        });
        continue;
      }

      const numero = numeroAppel(dateEmission.getFullYear(), appel.id);

      // **Deux documents, un seul envoi.** La lettre explique et s'adresse à
      // l'acquéreur ; le bordereau QR s'adresse à sa banque, qui paie. Aucun
      // des deux ne peut faire le travail de l'autre : une lettre ne se scanne
      // pas, et une banque ne lit pas un courrier.
      const documents = await this.produireDocuments(
        operationId,
        appel,
        numero,
        etapeLibelle,
        dateEmission,
        societe,
      );

      try {
        await this.mail.envoyer({
          to: adresses,
          subject: `Appel de fonds ${numero} — lot ${appel.lot}`,
          text: this.corpsAppel(appel, numero, etapeLibelle, societe, documents.bordereau !== null),
          pieces: documents.pieces,
        });
        await this.db.runInTenant(societeId, (tx) =>
          tx.appelDeFonds.update({
            where: { id: appel.id },
            data: { statut: 'ENVOYE', dateEnvoi: new Date() },
          }),
        );
        reussis += 1;
      } catch (erreur) {
        // L'appel existe et reste dû : un échec d'envoi ne l'annule pas.
        const raison = erreur instanceof Error ? erreur.message : 'Envoi impossible';
        this.logger.error(`Appel de fonds ${appel.id} non envoyé : ${raison}`);
        echecs.push({ appelId: appel.id, raison });
      }
    }

    return { reussis, echecs };
  }

  /**
   * Crée **un** appel de fonds pour une réservation donnée, dans la
   * transaction en cours.
   *
   * Extrait parce que deux chemins y mènent : la fin de jalon, qui appelle
   * toutes les réservations engagées, et le rattrapage, qui n'appelle que les
   * étapes choisies par le promoteur. Un second code de création aurait fini
   * par numéroter, référencer ou arrondir autrement.
   *
   * Renvoie `null` quand la réservation n'a pas d'assiette : mieux vaut sauter
   * et le dire qu'émettre un appel à zéro, qui passerait inaperçu.
   */
  private async creerAppel(
    tx: TenantDb,
    contexte: {
      operationId: number;
      etapeId: number;
      pourcentage: Prisma.Decimal;
      reservation: {
        id: number;
        prixTotalActe: Prisma.Decimal | null;
        lot: { reference: string };
        acquereurs: {
          role: string;
          quotePart: string | null;
          acquereur: {
            nom: string | null;
            prenom: string | null;
            raisonSociale: string | null;
            email: string | null;
            adresse: string | null;
            npa: string | null;
            localite: string | null;
          };
        }[];
      };
      dateEmission: Date;
      dateEcheance: Date;
    },
  ): Promise<AppelCree | null> {
    const { reservation } = contexte;
    if (!reservation.prixTotalActe) {
      this.logger.warn(
        `Réservation ${reservation.id} sans prix total acte : aucun appel de fonds généré.`,
      );
      return null;
    }

    const montant = calculerMontantAppel(contexte.pourcentage, reservation.prixTotalActe);
    const qrReference = genererReferenceQR(contexte.operationId, reservation.id, contexte.etapeId);

    const appel = await tx.appelDeFonds.create({
      data: {
        reservationId: reservation.id,
        etapeId: contexte.etapeId,
        pourcentage: contexte.pourcentage,
        montant,
        statut: 'EMIS',
        dateEmission: contexte.dateEmission,
        dateEcheance: contexte.dateEcheance,
        qrReference,
      },
    });

    // Le numéro dérive de l'identifiant : lisible, unique, et stable.
    const numero = numeroAppel(contexte.dateEmission.getFullYear(), appel.id);
    await tx.appelDeFonds.update({ where: { id: appel.id }, data: { numero } });

    return {
      id: appel.id,
      reservationId: reservation.id,
      montant,
      lot: reservation.lot.reference,
      destinataires: reservation.acquereurs.map((lien) => ({
        nom: nomAffiche(lien.acquereur),
        email: lien.acquereur.email,
        adresse: lien.acquereur.adresse,
        npa: lien.acquereur.npa,
        localite: lien.acquereur.localite,
        role: lien.role,
        quotePart: lien.quotePart,
      })),
      qrReference,
      dateEcheance: contexte.dateEcheance,
    };
  }

  /**
   * Trace l'action, en disant la vérité sur son auteur.
   *
   * Une clôture venue de Kolabimo n'a pas d'auteur humain de notre côté :
   * lui attribuer le membership de la dernière session ferait porter à un
   * collaborateur une décision qu'il n'a pas prise.
   */
  private async tracer(
    tx: TenantDb,
    societeId: number,
    automatique: boolean,
    evenement: Parameters<AuditService['enregistrer']>[1],
  ): Promise<void> {
    if (automatique) {
      await this.audit.enregistrerAutomatique(tx, societeId, evenement);
      return;
    }
    await this.audit.enregistrer(tx, evenement);
  }

  /**
   * Produit la QR-facture et la dépose en GED.
   *
   * Elle est **archivée** en même temps qu'envoyée : un acquéreur qui perd le
   * message doit pouvoir se la faire renvoyer telle quelle, et le promoteur
   * doit pouvoir montrer ce qui est parti.
   *
   * Rien ici ne fait échouer l'appel de fonds : la créance existe déjà en
   * base, une pièce jointe manquante ne la remet pas en cause.
   */
  /**
   * Produit les **deux** documents d'un appel de fonds, et les archive.
   *
   * L'appel s'adresse à deux lecteurs qui n'ont pas le même besoin :
   * l'acquéreur, à qui il faut expliquer ce qui est dû et pourquoi, et sa
   * banque, qui paie le plus souvent à sa place et veut un bordereau qu'elle
   * puisse traiter. Un document unique servait mal les deux — l'acquéreur
   * recevait une facture et devait deviner qu'il fallait la transmettre.
   *
   * Les deux sont déposés en GED : un acquéreur qui perd le message doit
   * pouvoir se les faire renvoyer tels quels, et le promoteur doit pouvoir
   * montrer ce qui est parti.
   *
   * Rien ici ne fait échouer l'appel : la créance existe déjà en base. Un
   * bordereau manquant — société sans IBAN, adresse incomplète — laisse
   * partir la lettre, qui porte les coordonnées de paiement en clair.
   */
  private async produireDocuments(
    operationId: number,
    appel: AppelCree,
    numero: string,
    etapeLibelle: string,
    dateEmission: Date,
    societe: SocieteEmettrice,
  ): Promise<{
    pieces: { nom: string; contenu: Buffer; typeMime: string }[];
    bordereau: Buffer | null;
  }> {
    const pieces: { nom: string; contenu: Buffer; typeMime: string }[] = [];

    // --- 1. La lettre à l'acquéreur -----------------------------------
    try {
      const lettre = await this.lettre.generer({
        numero,
        lot: appel.lot,
        etapeLibelle,
        montant: appel.montant.toFixed(2),
        dateEmission,
        dateEcheance: appel.dateEcheance,
        referenceQR: appel.qrReference,
        societe,
        destinataires: appel.destinataires,
      });
      const nom = `${numero}-${appel.lot}-lettre.pdf`;
      pieces.push({ nom, contenu: lettre, typeMime: 'application/pdf' });
      await this.archiver(
        operationId,
        nom,
        lettre,
        `Appel de fonds ${numero} — lettre · lot ${appel.lot}`,
      );
    } catch (erreur) {
      this.logger.error(
        `Lettre ${numero} non produite : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }

    // --- 2. Le bordereau QR, destiné à la banque -----------------------
    let bordereau: Buffer | null = null;
    try {
      const resultat = await this.qrFacture.generer({
        montant: Number(appel.montant.toFixed(2)),
        numero,
        referenceQR: appel.qrReference,
        lot: appel.lot,
        etapeLibelle,
        dateEcheance: appel.dateEcheance,
        societe,
        // Le bordereau ne porte qu'un débiteur : la norme QR n'en admet pas
        // deux. C'est le contact principal du dossier — le signataire — et
        // cela ne change rien à la solidarité de la créance.
        acquereur: {
          nom: appel.destinataires[0]?.nom ?? '',
          adresse: appel.destinataires[0]?.adresse ?? null,
        },
      });
      if (resultat) {
        if (resultat.reference.type === 'AUCUNE') {
          // Le promoteur doit le savoir : sans référence structurée, le
          // rapprochement bancaire redevient manuel.
          this.logger.warn(`QR-facture ${numero} sans référence — ${resultat.reference.raison}`);
        }
        bordereau = resultat.pdf;
        const nom = `${numero}-${appel.lot}-bordereau-qr.pdf`;
        pieces.push({ nom, contenu: resultat.pdf, typeMime: 'application/pdf' });
        await this.archiver(
          operationId,
          nom,
          resultat.pdf,
          `Appel de fonds ${numero} — bordereau QR · lot ${appel.lot}`,
        );
      }
    } catch (erreur) {
      this.logger.error(
        `QR-facture ${numero} non produite : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }

    return { pieces, bordereau };
  }

  /** Dépose une pièce en GED sans jamais faire échouer l'appel qui la porte. */
  private async archiver(
    operationId: number,
    nom: string,
    contenu: Buffer,
    titre: string,
  ): Promise<void> {
    try {
      await this.ged.deposer(
        operationId,
        { nomOriginal: nom, mimeType: 'application/pdf', contenu },
        { titre, categorie: 'FACTURE' },
      );
    } catch (erreur) {
      this.logger.error(
        `${nom} non archivé en GED : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    }
  }

  private corpsAppel(
    appel: AppelCree,
    numero: string,
    etapeLibelle: string,
    societe: SocieteEmettrice,
    avecBordereau: boolean,
  ): string {
    const salutation =
      appel.destinataires.length > 1
        ? `Madame, Monsieur,`
        : `Madame, Monsieur ${appel.destinataires[0]?.nom ?? ''},`.replace(' ,', ',');

    // `null` = ligne absente ; `''` = ligne vide voulue. Filtrer les chaînes
    // vides écraserait la mise en page du message.
    const lignes: (string | null)[] = [
      salutation,
      '',
      `L'étape « ${etapeLibelle} » de votre promotion est achevée. Conformément à`,
      `l'échéancier de votre acte, nous vous prions de bien vouloir verser :`,
      '',
      `    Appel     : ${numero}`,
      `    Montant   : ${montantSuisse(appel.montant.toFixed(2))} CHF`,
      `    Lot       : ${appel.lot}`,
      `    Échéance  : ${appel.dateEcheance.toLocaleDateString('fr-CH')}`,
      `    Référence : ${formaterReferenceQR(appel.qrReference)}`,
      societe.iban ? `    IBAN      : ${societe.iban}` : null,
      '',
      avecBordereau
        ? 'Deux documents sont joints : une lettre récapitulative, et un bordereau'
        : "Une lettre récapitulative est jointe. Le bordereau de versement n'a pas",
      avecBordereau
        ? 'de versement avec QR-facture destiné à votre banque. Si votre acquisition'
        : 'pu être établi — les coordonnées de paiement ci-dessus font foi.',
      avecBordereau
        ? 'est financée par un prêt hypothécaire, merci de transmettre ce bordereau'
        : null,
      avecBordereau
        ? 'à votre établissement bancaire : c’est lui qui procédera au versement.'
        : null,
      '',
      appel.destinataires.length > 1
        ? 'Ce message est adressé à l’ensemble des acquéreurs du dossier. La créance'
        : null,
      appel.destinataires.length > 1
        ? 'est solidaire : un seul versement du montant total la solde.'
        : null,
      appel.destinataires.length > 1 ? '' : null,
      'Merci de rappeler la référence ci-dessus lors de votre versement : elle',
      "permet d'affecter automatiquement le paiement à votre lot.",
      '',
      societe.raisonSociale,
      [societe.adresse, [societe.codePostal, societe.localite].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' — ') || null,
    ];

    return lignes.filter((l): l is string => l !== null).join('\n');
  }

  // ===================================================================
  //  Consultation et suivi
  // ===================================================================

  async lister(operationId: number, options: { enRetard?: boolean } = {}) {
    const maintenant = new Date();

    const appels = await this.db.run((tx) =>
      tx.appelDeFonds.findMany({
        where: { reservation: { operationId } },
        include: {
          reservation: {
            select: {
              id: true,
              lot: { select: { reference: true } },
              acquereur: { select: { nom: true, prenom: true, email: true } },
            },
          },
          etape: { select: { id: true, ordre: true, libelle: true } },
          encaissements: {
            select: { id: true, montant: true, dateValeur: true, source: true },
            orderBy: { dateValeur: 'asc' },
          },
        },
        orderBy: [{ etape: { ordre: 'asc' } }, { id: 'asc' }],
      }),
    );

    const enrichis = appels.map((a) => ({
      ...a,
      etat: etatAppel(
        a.montant,
        a.encaissements.map((e) => e.montant),
        a.dateEcheance,
        maintenant,
      ),
    }));

    return options.enRetard ? enrichis.filter((a) => a.etat.enRetard) : enrichis;
  }

  /**
   * Enregistre un encaissement et met le statut à jour.
   *
   * `source` distingue une saisie manuelle d'un rapprochement camt.054 : le
   * jour où la passerelle bancaire arrive, on veut savoir ce qui a été
   * rapproché automatiquement et ce qui a été pointé à la main.
   */
  async enregistrerEncaissement(
    operationId: number,
    appelId: number,
    donnees: {
      montant: Prisma.Decimal;
      dateValeur: Date;
      reference?: string | null;
      source?: string | null;
    },
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;
    const societeId = RequestContext.requireSocieteId();

    const { encaissement, etat, evenementSortant } = await this.db.run(async (tx) => {
      const appel = await tx.appelDeFonds.findFirst({
        where: { id: appelId, reservation: { operationId } },
        include: {
          encaissements: { select: { montant: true } },
          reservation: {
            select: { externalId: true, lot: { select: { reference: true } } },
          },
        },
      });
      if (!appel) throw new NotFoundException(`Appel de fonds ${appelId} introuvable.`);
      if (appel.statut === 'ANNULE') {
        throw new BadRequestException(
          "Cet appel de fonds est annulé : il n'attend aucun paiement.",
        );
      }

      const encaissement = await tx.encaissement.create({
        data: {
          appelDeFondsId: appelId,
          ...donnees,
          source: donnees.source ?? 'saisie',
          confirmeParId: membershipId,
          dateConfirmation: new Date(),
        },
      });

      const etat = etatAppel(
        appel.montant,
        [...appel.encaissements.map((e) => e.montant), donnees.montant],
        appel.dateEcheance,
        new Date(),
      );

      await tx.appelDeFonds.update({
        where: { id: appelId },
        data: { statut: etat.soldé ? 'PAYE' : 'PARTIELLEMENT_PAYE' },
      });

      await this.audit.enregistrer(tx, {
        action: 'appel_de_fonds.encaissement',
        entite: 'Encaissement',
        entiteId: encaissement.id,
        donnees: {
          operationId,
          appelId,
          lot: appel.reservation.lot.reference,
          montant: donnees.montant,
          cumul: etat.montantEncaisse,
          solde: etat.solde,
          source: donnees.source ?? 'saisie',
        },
      });

      // Kolabimo tient une trésorerie ; c'est nous qui savons ce qui est
      // encaissé. On le lui dit, sans jamais lui demander la permission.
      const evenementSortant = await this.passerelle.deposerSortant(tx, {
        evenement: 'encaissement.enregistre',
        cle: String(encaissement.id),
        societeId,
        donnees: {
          operationId,
          reservationExternalId: appel.reservation.externalId,
          lot: appel.reservation.lot.reference,
          appelNumero: appel.numero,
          montant: donnees.montant.toFixed(2),
          dateValeur: donnees.dateValeur.toISOString(),
          cumulEncaisse: etat.montantEncaisse.toFixed(2),
          solde: etat.solde.toFixed(2),
          integralementPaye: etat.soldé,
          source: donnees.source ?? 'saisie',
        },
      });

      return { encaissement, etat, evenementSortant };
    });

    const synchronisation = await this.passerelle.livrer(evenementSortant);
    return { encaissement, etat, synchronisation };
  }

  /** Relance d'un appel échu et non soldé. */
  async relancer(operationId: number, appelId: number) {
    const appel = await this.db.run((tx) =>
      tx.appelDeFonds.findFirst({
        where: { id: appelId, reservation: { operationId } },
        include: {
          encaissements: { select: { montant: true } },
          etape: { select: { libelle: true } },
          reservation: {
            select: {
              lot: { select: { reference: true } },
              acquereurs: {
                orderBy: { ordre: 'asc' },
                select: {
                  acquereur: {
                    select: { nom: true, prenom: true, raisonSociale: true, email: true },
                  },
                },
              },
            },
          },
        },
      }),
    );
    if (!appel) throw new NotFoundException(`Appel de fonds ${appelId} introuvable.`);

    const etat = etatAppel(
      appel.montant,
      appel.encaissements.map((e) => e.montant),
      appel.dateEcheance,
      new Date(),
    );
    if (etat.soldé) {
      throw new BadRequestException('Cet appel de fonds est soldé : rien à relancer.');
    }
    const personnes = appel.reservation.acquereurs.map((l) => l.acquereur);
    const adresses = personnes
      .map((p) => p.email)
      .filter((e): e is string => e !== null && e.trim() !== '');

    if (adresses.length === 0) {
      throw new BadRequestException(
        personnes.length === 0
          ? "Ce dossier n'a pas encore d'acquéreur nominatif : Kolabimo livre l'identité " +
              'au palier FONDS_VERSES.'
          : "Aucun acquéreur du dossier n'a d'adresse e-mail.",
      );
    }

    // La relance suit la même règle que l'appel : solidaire, donc adressée à
    // tout le dossier. Relancer une seule personne d'une indivision reviendrait
    // à choisir un débiteur là où l'acte n'en distingue pas.
    const nom = personnes.length > 1 ? '' : nomAffiche(personnes[0]!);

    const resultat = await this.mail.envoyer({
      to: adresses,
      subject: `Rappel — appel de fonds ${appel.numero ?? appel.id}, lot ${appel.reservation.lot.reference}`,
      text: [
        `Madame, Monsieur ${nom},`.replace(' ,', ','),
        '',
        `Sauf erreur de notre part, l'appel de fonds ${appel.numero ?? ''} reste ouvert.`,
        '',
        `    Montant appelé  : ${montantSuisse(appel.montant.toFixed(2))} CHF`,
        `    Déjà versé      : ${montantSuisse(etat.montantEncaisse.toFixed(2))} CHF`,
        `    Solde dû        : ${montantSuisse(etat.solde.toFixed(2))} CHF`,
        appel.dateEcheance
          ? `    Échéance        : ${appel.dateEcheance.toLocaleDateString('fr-CH')}`
          : null,
        appel.qrReference
          ? `    Référence       : ${formaterReferenceQR(appel.qrReference)}`
          : null,
        '',
        'Si votre versement a été effectué entre-temps, merci de ne pas tenir compte',
        'de ce rappel.',
        // `null` = ligne absente ; `''` = ligne vide voulue.
      ]
        .filter((l): l is string => l !== null)
        .join('\n'),
    });

    await this.db.run(async (tx) => {
      if (etat.enRetard) {
        await tx.appelDeFonds.update({ where: { id: appelId }, data: { statut: 'EN_RETARD' } });
      }
      await this.audit.enregistrer(tx, {
        action: 'appel_de_fonds.relance',
        entite: 'AppelDeFonds',
        entiteId: appelId,
        donnees: { operationId, solde: etat.solde, destinataire: resultat.destinatairePrevu },
      });
    });

    return { relance: true, solde: etat.solde.toFixed(2), envoi: resultat };
  }
}
