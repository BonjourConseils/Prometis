import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BienNature, type LotStatut, type ParkingType } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';

export interface DonneesParcelle {
  numero: string;
  egrid?: string | null;
  commune?: string | null;
  surfaceM2?: Prisma.Decimal | null;
  affectationZone?: string | null;
  registreFoncier?: string | null;
  note?: string | null;
}

export interface DonneesBien {
  nature: BienNature;
  nom: string;
  nbEtages?: number | null;
  description?: string | null;
}

export interface DonneesLot {
  reference: string;
  etage?: number | null;
  nombrePieces?: Prisma.Decimal | null;
  surfaceM2?: Prisma.Decimal | null;
  quotePartPPE?: Prisma.Decimal | null;
  prixVente?: Prisma.Decimal | null;
  statut?: LotStatut;
}

export interface DonneesParking {
  reference?: string | null;
  type: ParkingType;
  prix?: Prisma.Decimal | null;
  ordre?: number;
}

export interface DonneesPpe {
  bienId?: number | null;
  numero?: string | null;
  dateActeConstitutif?: Date | null;
  notaireActeurId?: number | null;
  totalMillemes?: number;
  note?: string | null;
}

@Injectable()
export class FoncierService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===================================================================
  //  Cohérence parent → enfant
  //
  //  La RLS garantit qu'une ligne appartient au bon TENANT, pas qu'elle
  //  appartient à la bonne OPÉRATION. Sans ces contrôles, un membre ayant
  //  accès à l'opération A pourrait modifier un lot de l'opération B de la
  //  même société — le guard d'accès par opération serait contourné.
  // ===================================================================

  private async bienDeLOperation(tx: TenantDb, operationId: number, bienId: number) {
    const bien = await tx.bien.findFirst({
      where: { id: bienId, operationId },
      select: { id: true, nom: true },
    });
    if (!bien) throw new NotFoundException(`Bien ${bienId} introuvable dans cette opération.`);
    return bien;
  }

  private async lotDeLOperation(tx: TenantDb, operationId: number, lotId: number) {
    const lot = await tx.lot.findFirst({
      where: { id: lotId, bien: { operationId } },
      select: { id: true, reference: true, bienId: true },
    });
    if (!lot) throw new NotFoundException(`Lot ${lotId} introuvable dans cette opération.`);
    return lot;
  }

  private async parkingDeLOperation(tx: TenantDb, operationId: number, parkingId: number) {
    const parking = await tx.parking.findFirst({
      where: { id: parkingId, lot: { bien: { operationId } } },
      select: { id: true, reference: true, lotId: true },
    });
    if (!parking) {
      throw new NotFoundException(`Place de parc ${parkingId} introuvable dans cette opération.`);
    }
    return parking;
  }

  // ===================================================================
  //  Parcelles
  // ===================================================================

  async listerParcelles(operationId: number) {
    return this.db.run((tx) =>
      tx.parcelle.findMany({ where: { operationId }, orderBy: { numero: 'asc' } }),
    );
  }

  async creerParcelle(operationId: number, donnees: DonneesParcelle) {
    return this.db.run(async (tx) => {
      const parcelle = await tx.parcelle.create({ data: { operationId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'parcelle.creee',
        entite: 'Parcelle',
        entiteId: parcelle.id,
        donnees: { operationId, numero: parcelle.numero },
      });
      return parcelle;
    });
  }

  async modifierParcelle(
    operationId: number,
    parcelleId: number,
    donnees: Partial<DonneesParcelle>,
  ) {
    return this.db.run(async (tx) => {
      const { count } = await tx.parcelle.updateMany({
        where: { id: parcelleId, operationId },
        data: donnees,
      });
      if (count === 0) throw new NotFoundException(`Parcelle ${parcelleId} introuvable.`);

      await this.audit.enregistrer(tx, {
        action: 'parcelle.modifiee',
        entite: 'Parcelle',
        entiteId: parcelleId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return tx.parcelle.findUniqueOrThrow({ where: { id: parcelleId } });
    });
  }

  async supprimerParcelle(operationId: number, parcelleId: number) {
    return this.db.run(async (tx) => {
      const { count } = await tx.parcelle.deleteMany({ where: { id: parcelleId, operationId } });
      if (count === 0) throw new NotFoundException(`Parcelle ${parcelleId} introuvable.`);
      await this.audit.enregistrer(tx, {
        action: 'parcelle.supprimee',
        entite: 'Parcelle',
        entiteId: parcelleId,
        donnees: { operationId },
      });
      return { supprime: true };
    });
  }

  // ===================================================================
  //  Biens et lots
  // ===================================================================

  async listerBiens(operationId: number) {
    return this.db.run((tx) =>
      tx.bien.findMany({
        where: { operationId },
        include: {
          _count: { select: { lots: true } },
          lots: {
            select: {
              id: true,
              reference: true,
              etage: true,
              nombrePieces: true,
              surfaceM2: true,
              quotePartPPE: true,
              prixVente: true,
              statut: true,
              parkings: { select: { id: true, reference: true, type: true, prix: true } },
            },
            orderBy: { reference: 'asc' },
          },
        },
        orderBy: { nom: 'asc' },
      }),
    );
  }

  async creerBien(operationId: number, donnees: DonneesBien) {
    return this.db.run(async (tx) => {
      const bien = await tx.bien.create({ data: { operationId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'bien.cree',
        entite: 'Bien',
        entiteId: bien.id,
        donnees: { operationId, nom: bien.nom, nature: bien.nature },
      });
      return bien;
    });
  }

  async modifierBien(operationId: number, bienId: number, donnees: Partial<DonneesBien>) {
    return this.db.run(async (tx) => {
      await this.bienDeLOperation(tx, operationId, bienId);
      const bien = await tx.bien.update({ where: { id: bienId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'bien.modifie',
        entite: 'Bien',
        entiteId: bienId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return bien;
    });
  }

  async creerLot(operationId: number, bienId: number, donnees: DonneesLot) {
    return this.db.run(async (tx) => {
      await this.bienDeLOperation(tx, operationId, bienId);

      const doublon = await tx.lot.findFirst({
        where: { bienId, reference: donnees.reference },
        select: { id: true },
      });
      if (doublon) {
        throw new BadRequestException(
          `La référence « ${donnees.reference} » existe déjà dans ce bien.`,
        );
      }

      const lot = await tx.lot.create({ data: { bienId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'lot.cree',
        entite: 'Lot',
        entiteId: lot.id,
        donnees: { operationId, bienId, reference: lot.reference },
      });
      return lot;
    });
  }

  async modifierLot(operationId: number, lotId: number, donnees: Partial<DonneesLot>) {
    return this.db.run(async (tx) => {
      const avant = await this.lotDeLOperation(tx, operationId, lotId);

      // Le prix d'un lot vendu ne doit pas dériver : le prix total acte est
      // figé dans la réservation, et l'écart deviendrait invisible.
      if (donnees.prixVente !== undefined) {
        const vendu = await tx.reservation.findFirst({
          where: { lotId, dateSignatureActe: { not: null } },
          select: { id: true },
        });
        if (vendu) {
          throw new BadRequestException(
            'Ce lot a un acte signé : son prix de vente ne peut plus être modifié. ' +
              'Le prix total acte est figé dans la réservation.',
          );
        }
      }

      const lot = await tx.lot.update({ where: { id: lotId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'lot.modifie',
        entite: 'Lot',
        entiteId: lotId,
        donnees: { operationId, reference: avant.reference, champs: Object.keys(donnees) },
      });
      return lot;
    });
  }

  // ===================================================================
  //  Places de parc
  // ===================================================================

  async creerParking(operationId: number, lotId: number, donnees: DonneesParking) {
    return this.db.run(async (tx) => {
      const lot = await this.lotDeLOperation(tx, operationId, lotId);
      const parking = await tx.parking.create({ data: { lotId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'parking.cree',
        entite: 'Parking',
        entiteId: parking.id,
        // Une place de parc change le prix total acte du lot : la trace doit
        // permettre de comprendre un écart d'appel de fonds.
        donnees: { operationId, lot: lot.reference, type: parking.type, prix: parking.prix },
      });
      return parking;
    });
  }

  async modifierParking(operationId: number, parkingId: number, donnees: Partial<DonneesParking>) {
    return this.db.run(async (tx) => {
      await this.parkingDeLOperation(tx, operationId, parkingId);
      const parking = await tx.parking.update({ where: { id: parkingId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'parking.modifie',
        entite: 'Parking',
        entiteId: parkingId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return parking;
    });
  }

  async supprimerParking(operationId: number, parkingId: number) {
    return this.db.run(async (tx) => {
      await this.parkingDeLOperation(tx, operationId, parkingId);
      await tx.parking.delete({ where: { id: parkingId } });
      await this.audit.enregistrer(tx, {
        action: 'parking.supprime',
        entite: 'Parking',
        entiteId: parkingId,
        donnees: { operationId },
      });
      return { supprime: true };
    });
  }

  // ===================================================================
  //  PPE et registre
  // ===================================================================

  async listerPpe(operationId: number) {
    return this.db.run((tx) => tx.ppe.findMany({ where: { operationId }, orderBy: { id: 'asc' } }));
  }

  async creerPpe(operationId: number, donnees: DonneesPpe) {
    return this.db.run(async (tx) => {
      if (donnees.bienId) await this.bienDeLOperation(tx, operationId, donnees.bienId);
      const ppe = await tx.ppe.create({ data: { operationId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'ppe.creee',
        entite: 'Ppe',
        entiteId: ppe.id,
        donnees: { operationId, numero: ppe.numero },
      });
      return ppe;
    });
  }

  /**
   * Registre PPE : quotes-parts par immeuble, contrôlées contre le total de
   * millièmes de la constitution.
   *
   * L'écart est **calculé et exposé**, pas masqué : une somme de millièmes qui
   * ne tombe pas juste est une anomalie que le promoteur doit voir tout de
   * suite, pas découvrir chez le notaire.
   */
  async registrePpe(operationId: number) {
    const { biens, ppes, parcelles } = await this.db.run(async (tx) => ({
      biens: await tx.bien.findMany({
        where: { operationId },
        select: {
          id: true,
          nom: true,
          nature: true,
          lots: {
            select: {
              id: true,
              reference: true,
              etage: true,
              surfaceM2: true,
              quotePartPPE: true,
              statut: true,
            },
            orderBy: { reference: 'asc' },
          },
        },
        orderBy: { nom: 'asc' },
      }),
      ppes: await tx.ppe.findMany({ where: { operationId } }),
      parcelles: await tx.parcelle.findMany({
        where: { operationId },
        orderBy: { numero: 'asc' },
      }),
    }));

    const totalMillemesGlobal = ppes[0]?.totalMillemes ?? 1000;

    const sommeMillemes = biens
      .flatMap((b) => b.lots)
      .reduce<Prisma.Decimal>(
        (total, lot) => (lot.quotePartPPE ? total.plus(lot.quotePartPPE) : total),
        new Prisma.Decimal(0),
      );

    return {
      parcelles,
      ppes,
      biens: biens.map((bien) => ({
        ...bien,
        sommeMillemes: bien.lots.reduce<Prisma.Decimal>(
          (total, lot) => (lot.quotePartPPE ? total.plus(lot.quotePartPPE) : total),
          new Prisma.Decimal(0),
        ),
      })),
      controle: {
        totalMillemes: totalMillemesGlobal,
        sommeMillemes,
        ecart: sommeMillemes.minus(totalMillemesGlobal),
        coherent: sommeMillemes.equals(new Prisma.Decimal(totalMillemesGlobal)),
        nombreLots: biens.reduce((n, b) => n + b.lots.length, 0),
      },
    };
  }
}
