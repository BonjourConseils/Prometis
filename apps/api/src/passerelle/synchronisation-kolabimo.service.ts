import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LotStatut, type ParkingType } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { OperationsService } from '../operations/operations.service';
import { RequestContext } from '../context/request-context';
import { ConnexionKolabimoService } from './connexion-kolabimo.service';
import { KolabimoClient, type AccesKolabimo } from './kolabimo.client';
import { PasserelleService } from './passerelle.service';
import { referenceDeDossier, type DossierEntrant } from './reconciliation';
import {
  versDecimal,
  type EcheancierKolabimo,
  type LotsKolabimo,
  type ReservationsKolabimo,
} from './kolabimo-api';

const STATUTS_LOT: readonly LotStatut[] = ['DISPONIBLE', 'RESERVE', 'EN_ATTENTE_NOTAIRE', 'VENDU'];
const TYPES_PARKING: readonly ParkingType[] = [
  'EXTERIEURE',
  'INTERIEURE',
  'COUVERTE',
  'BOX',
  'AUTRE',
];
const STATUTS_ETAPE = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;

export interface RapportSynchronisation {
  operation: { id: number; nom: string };
  promotion: { id: number; nom: string };
  biens: { crees: number };
  lots: { crees: number; misAJour: number; total: number };
  parkings: { crees: number; misAJour: number };
  echeancier: {
    creees: number;
    misesAJour: number;
    adoptees: number;
    /** Ce qu'on a refusé d'appliquer, et pourquoi. */
    refus: string[];
    /** Étapes Prometis que Kolabimo ne connaît pas. */
    horsKolabimo: string[];
  };
  reservations: {
    recues: number;
    traitees: number;
    ignorees: number;
    enErreur: number;
    erreurs: string[];
  };
}

/**
 * Lire une promotion Kolabimo, et la faire vivre dans Prometis.
 *
 * Kolabimo est maître des lots, des prix, de l'échéancier et des
 * réservations ; Prometis gère **l'argent** — les appels de fonds et leurs
 * encaissements. Pour appeler des fonds, il faut pourtant les lots, leur prix
 * total acte, l'échéancier et les réservations engagées : on les tire donc de
 * Kolabimo, et on n'y touche pas à la main.
 *
 * Trois règles tiennent la synchronisation :
 *
 *   · **Elle est rejouable.** Chaque objet se retrouve par son identifiant
 *     Kolabimo ; rejouer met à jour, ne duplique pas.
 *   · **Elle ne déclenche jamais d'appel de fonds.** Une étape déjà terminée
 *     chez Kolabimo arrive terminée, sans créance — un lot vendu en cours de
 *     chantier passe par l'écran de rattrapage, où le promoteur choisit.
 *   · **Elle respecte ce qui est figé.** Le prix total acte d'une réservation
 *     et le pourcentage d'une étape qui a déjà produit un appel ne bougent pas,
 *     même à la demande de leur maître.
 */
@Injectable()
export class SynchronisationKolabimoService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly operations: OperationsService,
    private readonly connexions: ConnexionKolabimoService,
    private readonly kolabimo: KolabimoClient,
    private readonly passerelle: PasserelleService,
  ) {}

  /** Les promotions de la clé, et l'opération Prometis qui porte chacune. */
  async promotions(societeId: number) {
    const acces = await this.connexions.acces(societeId);
    const lecture = await this.kolabimo.promotions(acces);
    if (!lecture.ok) throw new BadRequestException(lecture.raison);

    const liees = await this.db.runInTenant(societeId, (tx) =>
      tx.operation.findMany({
        where: { kolabimoPromotionId: { in: lecture.donnees.promotions.map((p) => p.id) } },
        select: { id: true, nom: true, kolabimoPromotionId: true },
      }),
    );
    const parPromotion = new Map(liees.map((o) => [o.kolabimoPromotionId, o]));

    return lecture.donnees.promotions.map((p) => ({
      ...p,
      operation: parPromotion.get(p.id)
        ? { id: parPromotion.get(p.id)!.id, nom: parPromotion.get(p.id)!.nom }
        : null,
    }));
  }

  /**
   * La « photo » d'une promotion : lots, parkings, prix total acte,
   * échéancier, réservations. **Lecture seule** — rien n'est écrit chez nous.
   */
  async photo(societeId: number, promotionId: number) {
    const acces = await this.connexions.acces(societeId);
    const { lots, echeancier, reservations } = await this.tirer(acces, promotionId);

    const operation = await this.db.runInTenant(societeId, (tx) =>
      tx.operation.findFirst({
        where: { kolabimoPromotionId: promotionId },
        select: { id: true, nom: true },
      }),
    );

    return {
      promotion: {
        id: lots.promotionId,
        nom: lots.promotionNom,
        statut: lots.promotionStatut ?? null,
        localisation: lots.promotionLocalisation ?? null,
        promoteur: lots.promoteurNom ?? null,
      },
      operation,
      lots: lots.lots,
      echeancier: {
        totalPourcentage: echeancier.totalPourcentage,
        complet: echeancier.complet,
        etapes: echeancier.etapes,
      },
      // Sans identité : l'API ne la donne jamais. Elle arrive par le webhook
      // du palier FONDS_VERSES, et seulement par lui.
      reservations: reservations.map((r) => ({
        id: r.id,
        statut: r.statut,
        lot: r.appartement?.reference ?? null,
        clientReference: r.clientReference ?? null,
        agence: r.agence?.nom ?? null,
        dateSignature: r.dateSignature ?? null,
      })),
    };
  }

  /**
   * Rattache une promotion Kolabimo à une opération Prometis — existante, ou
   * créée pour l'occasion — puis la synchronise.
   *
   * Une promotion ne se rattache qu'à une opération, et réciproquement :
   * deux opérations sur la même promotion appelleraient deux fois les mêmes
   * acquéreurs.
   */
  async rattacher(
    societeId: number,
    promotionId: number,
    options: { operationId?: number } = {},
  ): Promise<RapportSynchronisation> {
    const acces = await this.connexions.acces(societeId);
    const lots = await this.exiger(this.kolabimo.lots(acces, promotionId));

    const dejaLiee = await this.db.runInTenant(societeId, (tx) =>
      tx.operation.findFirst({
        where: { kolabimoPromotionId: promotionId },
        select: { id: true, nom: true },
      }),
    );

    let operationId: number;
    if (options.operationId !== undefined) {
      if (dejaLiee && dejaLiee.id !== options.operationId) {
        throw new ConflictException(
          `« ${lots.promotionNom} » est déjà rattachée à l'opération « ${dejaLiee.nom} ». ` +
            `Deux opérations sur une même promotion appelleraient deux fois les mêmes acquéreurs.`,
        );
      }
      await this.db.runInTenant(societeId, async (tx) => {
        const cible = await tx.operation.findUnique({
          where: { id: options.operationId },
          select: { id: true, nom: true, kolabimoPromotionId: true },
        });
        if (!cible) throw new NotFoundException(`Opération ${options.operationId} introuvable.`);
        if (cible.kolabimoPromotionId !== null && cible.kolabimoPromotionId !== promotionId) {
          throw new ConflictException(
            `« ${cible.nom} » est déjà rattachée à la promotion Kolabimo ${cible.kolabimoPromotionId}.`,
          );
        }
        await tx.operation.update({
          where: { id: cible.id },
          data: { kolabimoPromotionId: promotionId, commercialisationActive: true },
        });
      });
      operationId = options.operationId;
    } else if (dejaLiee) {
      operationId = dejaLiee.id;
    } else {
      // Par le service des opérations, pas en direct : le créateur reçoit
      // d'office MANAGE, comme pour toute opération créée à la main.
      const creee = await this.operations.creer({
        nom: lots.promotionNom,
        commune: lots.promotionLocalisation ?? null,
      });
      await this.db.runInTenant(societeId, (tx) =>
        tx.operation.update({
          where: { id: creee.id },
          data: { kolabimoPromotionId: promotionId, commercialisationActive: true },
        }),
      );
      operationId = creee.id;
    }

    return this.synchroniser(societeId, operationId);
  }

  /** Rejoue la synchronisation d'une opération déjà rattachée. */
  async synchroniser(societeId: number, operationId: number): Promise<RapportSynchronisation> {
    const operation = await this.db.runInTenant(societeId, (tx) =>
      tx.operation.findUnique({
        where: { id: operationId },
        select: { id: true, nom: true, kolabimoPromotionId: true },
      }),
    );
    if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);
    if (operation.kolabimoPromotionId === null) {
      throw new BadRequestException(
        `« ${operation.nom} » n'est rattachée à aucune promotion Kolabimo.`,
      );
    }

    const acces = await this.connexions.acces(societeId);
    const { lots, echeancier, reservations } = await this.tirer(
      acces,
      operation.kolabimoPromotionId,
    );

    const rapport: RapportSynchronisation = {
      operation: { id: operation.id, nom: operation.nom },
      promotion: { id: lots.promotionId, nom: lots.promotionNom },
      biens: { crees: 0 },
      lots: { crees: 0, misAJour: 0, total: lots.lots.length },
      parkings: { crees: 0, misAJour: 0 },
      echeancier: { creees: 0, misesAJour: 0, adoptees: 0, refus: [], horsKolabimo: [] },
      reservations: { recues: 0, traitees: 0, ignorees: 0, enErreur: 0, erreurs: [] },
    };

    // Lots et échéancier dans UNE transaction : un catalogue à moitié importé
    // produirait des appels de fonds sur une assiette incomplète.
    await this.db.runInTenant(societeId, async (tx) => {
      await this.appliquerLots(tx, operation.id, lots, rapport);
      await this.appliquerEcheancier(tx, operation.id, echeancier, rapport);
    });

    // Les réservations ensuite, une par une, par le chemin des webhooks.
    for (const dossier of dossiersDepuisReservations(reservations)) {
      rapport.reservations.recues += 1;
      const traitement = await this.passerelle.appliquerDossierTire(societeId, dossier);
      if (traitement.statut === 'TRAITE') rapport.reservations.traitees += 1;
      else if (traitement.statut === 'IGNORE') rapport.reservations.ignorees += 1;
      else {
        rapport.reservations.enErreur += 1;
        rapport.reservations.erreurs.push(
          `Réservation Kolabimo ${dossier.reservationId} : ${traitement.erreur ?? 'erreur'}`,
        );
      }
    }

    await this.db.runInTenant(societeId, (tx) =>
      this.audit.enregistrer(tx, {
        action: 'kolabimo.promotion_synchronisee',
        entite: 'Operation',
        entiteId: operation.id,
        donnees: {
          operationId: operation.id,
          promotionKolabimo: lots.promotionId,
          lots: rapport.lots,
          parkings: rapport.parkings,
          echeancier: {
            creees: rapport.echeancier.creees,
            misesAJour: rapport.echeancier.misesAJour,
            adoptees: rapport.echeancier.adoptees,
            refus: rapport.echeancier.refus.length,
          },
          reservations: {
            recues: rapport.reservations.recues,
            traitees: rapport.reservations.traitees,
            enErreur: rapport.reservations.enErreur,
          },
          par: RequestContext.workspace()?.membershipId ?? null,
        },
      }),
    );

    return rapport;
  }

  // ===================================================================

  /**
   * Les trois lectures d'une promotion. Les réservations sont celles de
   * TOUTES les promotions du promoteur — l'API n'a pas de filtre : on ne
   * garde que celles des appartements de la promotion.
   */
  private async tirer(acces: AccesKolabimo, promotionId: number) {
    const [lots, echeancier, reservations] = await Promise.all([
      this.exiger(this.kolabimo.lots(acces, promotionId)),
      this.exiger(this.kolabimo.echeancier(acces, promotionId)),
      this.exiger(this.kolabimo.reservations(acces)),
    ]);
    const appartements = new Set(lots.lots.map((l) => l.id));
    return {
      lots,
      echeancier,
      reservations: reservations.filter((r) => r.appartement && appartements.has(r.appartement.id)),
    };
  }

  private async exiger<T>(
    lecture: Promise<{ ok: true; donnees: T } | { ok: false; raison: string }>,
  ): Promise<T> {
    const resultat = await lecture;
    if (!resultat.ok) throw new BadRequestException(resultat.raison);
    return resultat.donnees;
  }

  /**
   * Immeubles → biens, appartements → lots, parkings → parkings.
   *
   * Un lot se retrouve par son identifiant Kolabimo, à défaut par sa
   * référence dans l'opération — c'est ce qui permet de rattacher une
   * opération saisie à la main sans doubler ses lots. Un parking, lui, se
   * retrouve par sa référence : l'API ne donne pas son identifiant.
   */
  private async appliquerLots(
    tx: TenantDb,
    operationId: number,
    catalogue: LotsKolabimo,
    rapport: RapportSynchronisation,
  ) {
    const biens = await tx.bien.findMany({
      where: { operationId },
      select: { id: true, nom: true },
    });
    const bienParNom = new Map(biens.map((b) => [b.nom, b.id]));

    for (const lotK of catalogue.lots) {
      let bienId = bienParNom.get(lotK.immeubleNom);
      if (bienId === undefined) {
        const bien = await tx.bien.create({
          data: { operationId, nature: 'IMMEUBLE', nom: lotK.immeubleNom },
          select: { id: true },
        });
        bienId = bien.id;
        bienParNom.set(lotK.immeubleNom, bienId);
        rapport.biens.crees += 1;
      }

      const champs = {
        reference: lotK.reference,
        etage: lotK.etage ?? null,
        nombrePieces: versDecimal(lotK.nombrePieces),
        surfaceM2: versDecimal(lotK.surfaceM2),
        prixVente: versDecimal(lotK.prixVente),
        kolabimoAppartementId: lotK.id,
        ...(STATUTS_LOT.includes(lotK.statut as LotStatut)
          ? { statut: lotK.statut as LotStatut }
          : {}),
      };

      const existant = await tx.lot.findFirst({
        where: {
          bien: { operationId },
          OR: [
            { kolabimoAppartementId: lotK.id },
            { kolabimoAppartementId: null, reference: lotK.reference },
          ],
        },
        orderBy: { kolabimoAppartementId: { sort: 'asc', nulls: 'last' } },
        select: { id: true },
      });

      const lotId = existant
        ? (
            await tx.lot.update({
              where: { id: existant.id },
              data: { ...champs, bienId },
              select: { id: true },
            })
          ).id
        : (await tx.lot.create({ data: { ...champs, bienId }, select: { id: true } })).id;
      if (existant) rapport.lots.misAJour += 1;
      else rapport.lots.crees += 1;

      for (const [rang, parkingK] of lotK.parkings.entries()) {
        const type = TYPES_PARKING.includes(parkingK.type as ParkingType)
          ? (parkingK.type as ParkingType)
          : 'AUTRE';
        const reference = parkingK.reference ?? `${lotK.reference}-P${rang + 1}`;
        const parking = await tx.parking.findFirst({
          where: { lotId, reference },
          select: { id: true },
        });
        const donnees = { reference, type, prix: versDecimal(parkingK.prix) };
        if (parking) {
          await tx.parking.update({ where: { id: parking.id }, data: donnees });
          rapport.parkings.misAJour += 1;
        } else {
          await tx.parking.create({ data: { lotId, ...donnees } });
          rapport.parkings.crees += 1;
        }
      }
    }
  }

  /**
   * L'échéancier de Kolabimo, maître depuis le 2 septembre 2026.
   *
   * Une étape se retrouve par son identifiant Kolabimo ; une étape Prometis
   * sans identifiant, au même rang, est **adoptée** — c'est le cas d'un
   * échéancier saisi deux fois, une fois dans chaque produit. Ce qui reste
   * côté Prometis sans équivalent est signalé, jamais supprimé : il porte
   * peut-être des appels de fonds.
   *
   * Un pourcentage à 0 chez Kolabimo devient un **jalon de suivi** chez nous
   * (pourcentage nul) : c'est ainsi que Prometis dit « n'appelle rien ».
   */
  private async appliquerEcheancier(
    tx: TenantDb,
    operationId: number,
    echeancier: EcheancierKolabimo,
    rapport: RapportSynchronisation,
  ) {
    const locales = await tx.echeancierEtape.findMany({
      where: { operationId },
      select: {
        id: true,
        ordre: true,
        libelle: true,
        pourcentage: true,
        kolabimoEtapeId: true,
        _count: { select: { appelsDeFonds: true } },
      },
    });

    const correspondance = new Map<number, (typeof locales)[number]>();
    for (const etapeK of echeancier.etapes) {
      const liee =
        locales.find((l) => l.kolabimoEtapeId === etapeK.id) ??
        locales.find((l) => l.kolabimoEtapeId === null && l.ordre === etapeK.ordre);
      if (liee) correspondance.set(etapeK.id, liee);
    }
    const lieesIds = new Set([...correspondance.values()].map((l) => l.id));
    const libres = locales.filter((l) => !lieesIds.has(l.id));
    rapport.echeancier.horsKolabimo = libres.map((l) => `${l.ordre}. ${l.libelle}`);

    // Les conflits se détectent AVANT toute écriture. Le rang est unique par
    // opération : une étape Prometis sans équivalent qui occupe le rang d'une
    // étape Kolabimo ferait échouer la transaction au milieu — lots compris.
    // On refuse donc l'échéancier entier, en disant pourquoi, et le reste passe.
    const occupes = libres.filter((l) => echeancier.etapes.some((e) => e.ordre === l.ordre));
    const rangs = echeancier.etapes.map((e) => e.ordre);
    const doublons = rangs.filter((r, i) => rangs.indexOf(r) !== i);
    if (occupes.length > 0 || doublons.length > 0) {
      for (const l of occupes) {
        rapport.echeancier.refus.push(
          `Le rang ${l.ordre} est occupé dans Prometis par « ${l.libelle} », absente de Kolabimo. ` +
            `Supprimez-la ou déplacez-la, puis relancez : l'échéancier n'a pas été importé.`,
        );
      }
      for (const r of new Set(doublons)) {
        rapport.echeancier.refus.push(
          `Kolabimo porte deux étapes au rang ${r} : échéancier non importé.`,
        );
      }
      return;
    }

    // Rangs d'abord libérés : Kolabimo peut avoir permuté deux étapes, et la
    // première mise à jour heurterait la seconde. D'où le passage par des
    // rangs négatifs, que rien d'autre n'emploie.
    for (const locale of correspondance.values()) {
      await tx.echeancierEtape.update({ where: { id: locale.id }, data: { ordre: -locale.id } });
    }

    for (const etapeK of echeancier.etapes) {
      const pourcentage =
        etapeK.pourcentage === 0 ? null : new Prisma.Decimal(etapeK.pourcentage.toFixed(2));
      const statut = (STATUTS_ETAPE as readonly string[]).includes(etapeK.statut)
        ? (etapeK.statut as (typeof STATUTS_ETAPE)[number])
        : undefined;
      const locale = correspondance.get(etapeK.id);

      // Une étape close chez Kolabimo arrive close, SANS appel de fonds : un
      // lot vendu après coup passe par le rattrapage, où le promoteur choisit.
      const communs = {
        ordre: etapeK.ordre,
        libelle: etapeK.libelle,
        datePrevue: etapeK.datePrevue ?? null,
        kolabimoEtapeId: etapeK.id,
        syncedAt: new Date(),
        ...(statut ? { statut } : {}),
        ...(statut === 'COMPLETED' ? { dateCompletion: etapeK.dateCompletion ?? new Date() } : {}),
      };

      if (!locale) {
        await tx.echeancierEtape.create({ data: { operationId, ...communs, pourcentage } });
        rapport.echeancier.creees += 1;
        continue;
      }

      const memePourcentage =
        (locale.pourcentage === null && pourcentage === null) ||
        (locale.pourcentage !== null &&
          pourcentage !== null &&
          locale.pourcentage.equals(pourcentage));
      const fige = locale._count.appelsDeFonds > 0;
      if (!memePourcentage && fige) {
        rapport.echeancier.refus.push(
          `« ${etapeK.libelle} » : pourcentage figé à ${locale.pourcentage?.toFixed(2) ?? '—'} % — ` +
            `${locale._count.appelsDeFonds} appel(s) de fonds en découlent. ` +
            `Valeur Kolabimo ignorée : ${etapeK.pourcentage} %.`,
        );
      }

      await tx.echeancierEtape.update({
        where: { id: locale.id },
        data: { ...communs, ...(fige ? {} : { pourcentage }) },
      });
      if (locale.kolabimoEtapeId === null) rapport.echeancier.adoptees += 1;
      else rapport.echeancier.misesAJour += 1;
    }
  }
}

/** Une ligne de `GET /reservations` vers la forme commune aux deux contrats. */
function dossiersDepuisReservations(reservations: ReservationsKolabimo): DossierEntrant[] {
  return reservations.map((r) => ({
    externalId: r.externalId ?? null,
    reservationId: r.id,
    promotionId: null,
    appartementId: r.appartement?.id ?? null,
    statut: r.statut,
    dateReservation: r.createdAt ?? undefined,
    dateSignatureActe: r.dateSignature ?? undefined,
    clientRef: referenceDeDossier(r.clientReference, r.id),
    // L'API ne livre jamais l'identité. `undefined` — pas `[]` — pour ne pas
    // effacer celle qu'un webhook du palier aurait déjà apportée.
    personnes: undefined,
  }));
}
