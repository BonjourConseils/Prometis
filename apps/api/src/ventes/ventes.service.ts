import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type EcheancierEtapeStatut, type ReservationStatut } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { calculerPrixTotalActe, controlerEcheancier, estEngagee } from '../appels-de-fonds/calculs';

export interface DonneesAcquereur {
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
}

export interface DonneesReservation {
  lotId: number;
  acquereurId: number;
  statut?: ReservationStatut;
  prixTotalActe?: Prisma.Decimal | null;
  dateReservation?: Date;
  dateSignatureActe?: Date | null;
  notaireActeurId?: number | null;
  externalId?: string | null;
}

export interface DonneesEtape {
  ordre: number;
  libelle: string;
  description?: string | null;
  pourcentage?: Prisma.Decimal | null;
  datePrevue?: Date | null;
}

@Injectable()
export class VentesService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===================================================================
  //  Acquéreurs
  // ===================================================================

  async listerAcquereurs() {
    return this.db.run((tx) =>
      tx.acquereur.findMany({
        include: {
          reservations: {
            select: {
              id: true,
              statut: true,
              prixTotalActe: true,
              lot: { select: { reference: true } },
            },
          },
        },
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      }),
    );
  }

  async creerAcquereur(donnees: DonneesAcquereur) {
    const societeId = RequestContext.requireSocieteId();
    return this.db.run(async (tx) => {
      const acquereur = await tx.acquereur.create({ data: { societeId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'acquereur.cree',
        entite: 'Acquereur',
        entiteId: acquereur.id,
        donnees: { nom: acquereur.nom, prenom: acquereur.prenom },
      });
      return acquereur;
    });
  }

  async modifierAcquereur(acquereurId: number, donnees: Partial<DonneesAcquereur>) {
    return this.db.run(async (tx) => {
      const existe = await tx.acquereur.findUnique({
        where: { id: acquereurId },
        select: { id: true },
      });
      if (!existe) throw new NotFoundException(`Acquéreur ${acquereurId} introuvable.`);

      const acquereur = await tx.acquereur.update({ where: { id: acquereurId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'acquereur.modifie',
        entite: 'Acquereur',
        entiteId: acquereurId,
        donnees: { champs: Object.keys(donnees) },
      });
      return acquereur;
    });
  }

  // ===================================================================
  //  Réservations
  // ===================================================================

  private async reservationDeLOperation(tx: TenantDb, operationId: number, reservationId: number) {
    const reservation = await tx.reservation.findFirst({
      where: { id: reservationId, operationId },
      include: {
        lot: { select: { id: true, reference: true } },
        acquereur: { select: { id: true, nom: true, prenom: true, email: true } },
        appelsDeFonds: { select: { id: true } },
      },
    });
    if (!reservation) {
      throw new NotFoundException(`Réservation ${reservationId} introuvable dans cette opération.`);
    }
    return reservation;
  }

  async listerReservations(operationId: number) {
    return this.db.run((tx) =>
      tx.reservation.findMany({
        where: { operationId },
        include: {
          lot: {
            select: {
              id: true,
              reference: true,
              surfaceM2: true,
              prixVente: true,
              parkings: { select: { reference: true, type: true, prix: true } },
            },
          },
          acquereur: { select: { id: true, nom: true, prenom: true, email: true } },
          appelsDeFonds: {
            select: {
              id: true,
              numero: true,
              montant: true,
              statut: true,
              dateEcheance: true,
              encaissements: { select: { montant: true } },
            },
          },
        },
        orderBy: { lot: { reference: 'asc' } },
      }),
    );
  }

  /**
   * Crée une réservation et **fige le prix total acte**.
   *
   * Le prix est calculé une fois — prix du lot + Σ parkings — puis conservé.
   * Le prix du lot peut évoluer ensuite (indexation, changement de plan) ;
   * l'acte, lui, ne bouge plus, et c'est lui qui sert d'assiette aux appels
   * de fonds.
   */
  async creerReservation(operationId: number, donnees: DonneesReservation) {
    return this.db.run(async (tx) => {
      const lot = await tx.lot.findFirst({
        where: { id: donnees.lotId, bien: { operationId } },
        include: { parkings: { select: { prix: true } } },
      });
      if (!lot)
        throw new NotFoundException(`Lot ${donnees.lotId} introuvable dans cette opération.`);

      const acquereur = await tx.acquereur.findUnique({
        where: { id: donnees.acquereurId },
        select: { id: true, nom: true, prenom: true },
      });
      if (!acquereur) throw new NotFoundException(`Acquéreur ${donnees.acquereurId} introuvable.`);

      const active = await tx.reservation.findFirst({
        where: {
          lotId: donnees.lotId,
          statut: { in: ['OPTION', 'RESERVE', 'FONDS_VERSES', 'VENDU'] },
        },
        select: { id: true, statut: true },
      });
      if (active) {
        throw new BadRequestException(
          `Le lot ${lot.reference} porte déjà une réservation ${active.statut.toLowerCase()}. ` +
            "L'annuler ou la faire expirer avant d'en créer une autre.",
        );
      }

      const prixTotalActe =
        donnees.prixTotalActe ??
        calculerPrixTotalActe(
          lot.prixVente,
          lot.parkings.map((p) => p.prix),
        );

      const reservation = await tx.reservation.create({
        data: { operationId, ...donnees, prixTotalActe },
      });

      // Le statut du lot suit celui de la réservation : un lot réservé ne
      // doit pas rester affiché « disponible » sur le plan de vente.
      if (donnees.statut && estEngagee(donnees.statut)) {
        await tx.lot.update({
          where: { id: lot.id },
          data: { statut: donnees.statut === 'VENDU' ? 'VENDU' : 'RESERVE' },
        });
      }

      await this.audit.enregistrer(tx, {
        action: 'reservation.creee',
        entite: 'Reservation',
        entiteId: reservation.id,
        donnees: {
          operationId,
          lot: lot.reference,
          acquereur: `${acquereur.prenom ?? ''} ${acquereur.nom ?? ''}`.trim(),
          prixTotalActe,
        },
      });
      return reservation;
    });
  }

  /**
   * Modifie une réservation.
   *
   * Le prix total acte ne peut plus bouger une fois l'acte signé : des appels
   * de fonds sont déjà partis sur cette assiette, et la changer rendrait les
   * montants déjà émis incohérents avec le solde restant.
   */
  async modifierReservation(
    operationId: number,
    reservationId: number,
    donnees: Partial<DonneesReservation>,
  ) {
    return this.db.run(async (tx) => {
      const avant = await this.reservationDeLOperation(tx, operationId, reservationId);

      const prixChange =
        donnees.prixTotalActe !== undefined &&
        (donnees.prixTotalActe === null
          ? avant.prixTotalActe !== null
          : !avant.prixTotalActe?.equals(donnees.prixTotalActe));

      if (prixChange) {
        if (avant.dateSignatureActe) {
          throw new BadRequestException(
            "L'acte est signé : le prix total acte est figé et ne peut plus être modifié.",
          );
        }
        if (avant.appelsDeFonds.length > 0) {
          throw new BadRequestException(
            `${avant.appelsDeFonds.length} appel(s) de fonds ont déjà été émis sur cette réservation : ` +
              "changer l'assiette rendrait les montants émis incohérents.",
          );
        }
      }

      const reservation = await tx.reservation.update({
        where: { id: reservationId },
        data: donnees,
      });

      if (donnees.statut) {
        const statutLot =
          donnees.statut === 'VENDU'
            ? 'VENDU'
            : estEngagee(donnees.statut)
              ? 'RESERVE'
              : 'DISPONIBLE';
        await tx.lot.update({ where: { id: avant.lotId }, data: { statut: statutLot } });
      }

      await this.audit.enregistrer(tx, {
        action: 'reservation.modifiee',
        entite: 'Reservation',
        entiteId: reservationId,
        donnees: {
          operationId,
          lot: avant.lot.reference,
          avantStatut: avant.statut,
          apresStatut: reservation.statut,
          champs: Object.keys(donnees),
        },
      });
      return reservation;
    });
  }

  // ===================================================================
  //  Échéancier
  // ===================================================================

  async listerEtapes(operationId: number) {
    const etapes = await this.db.run((tx) =>
      tx.echeancierEtape.findMany({
        where: { operationId },
        include: {
          _count: { select: { appelsDeFonds: true } },
        },
        orderBy: { ordre: 'asc' },
      }),
    );

    return { etapes, controle: controlerEcheancier(etapes) };
  }

  async creerEtape(operationId: number, donnees: DonneesEtape) {
    return this.db.run(async (tx) => {
      const doublon = await tx.echeancierEtape.findFirst({
        where: { operationId, ordre: donnees.ordre },
        select: { id: true, libelle: true },
      });
      if (doublon) {
        throw new BadRequestException(
          `L'ordre ${donnees.ordre} est déjà occupé par « ${doublon.libelle} ».`,
        );
      }

      const etape = await tx.echeancierEtape.create({ data: { operationId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'echeancier_etape.creee',
        entite: 'EcheancierEtape',
        entiteId: etape.id,
        donnees: { operationId, libelle: etape.libelle, pourcentage: etape.pourcentage },
      });
      return etape;
    });
  }

  /**
   * Modifie une étape.
   *
   * Le pourcentage se fige dès qu'un appel de fonds en découle : le changer
   * ferait diverger les appels déjà émis de ceux qui restent à émettre, et
   * plus personne ne saurait quel pourcentage fait foi.
   *
   * Le statut ne se change pas ici — passer à `COMPLETED` déclenche les appels
   * de fonds, et cela passe par le moteur, pas par une mise à jour de champ.
   */
  async modifierEtape(
    operationId: number,
    etapeId: number,
    donnees: Partial<Omit<DonneesEtape, 'ordre'>>,
  ) {
    return this.db.run(async (tx) => {
      const avant = await tx.echeancierEtape.findFirst({
        where: { id: etapeId, operationId },
        include: { _count: { select: { appelsDeFonds: true } } },
      });
      if (!avant) throw new NotFoundException(`Étape ${etapeId} introuvable dans cette opération.`);

      if (donnees.pourcentage !== undefined && avant._count.appelsDeFonds > 0) {
        const identique =
          (avant.pourcentage === null && donnees.pourcentage === null) ||
          (avant.pourcentage !== null &&
            donnees.pourcentage !== null &&
            donnees.pourcentage !== undefined &&
            avant.pourcentage.equals(donnees.pourcentage));
        if (!identique) {
          throw new BadRequestException(
            `${avant._count.appelsDeFonds} appel(s) de fonds découlent de cette étape : ` +
              'son pourcentage ne peut plus être modifié.',
          );
        }
      }

      const etape = await tx.echeancierEtape.update({ where: { id: etapeId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'echeancier_etape.modifiee',
        entite: 'EcheancierEtape',
        entiteId: etapeId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return etape;
    });
  }

  /** Avancement d'un jalon sans déclenchement — `COMPLETED` passe par le moteur. */
  async changerAvancement(
    operationId: number,
    etapeId: number,
    statut: Exclude<EcheancierEtapeStatut, 'COMPLETED'>,
  ) {
    return this.db.run(async (tx) => {
      const { count } = await tx.echeancierEtape.updateMany({
        where: { id: etapeId, operationId },
        data: { statut, ...(statut === 'NOT_STARTED' ? { dateCompletion: null } : {}) },
      });
      if (count === 0) throw new NotFoundException(`Étape ${etapeId} introuvable.`);

      await this.audit.enregistrer(tx, {
        action: 'echeancier_etape.avancement',
        entite: 'EcheancierEtape',
        entiteId: etapeId,
        donnees: { operationId, statut },
      });
      return tx.echeancierEtape.findUniqueOrThrow({ where: { id: etapeId } });
    });
  }
}
