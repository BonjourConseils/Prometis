import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CommissionStatut, type MandatStatut } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  MANDATS_EN_VIGUEUR,
  calculerCommission,
  conflitExclusivite,
  mandatCouvre,
} from './commission';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class CourtageService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===================================================================
  //  Mandats
  // ===================================================================

  async listerMandats(operationId: number) {
    const mandats = await this.db.run((tx) =>
      tx.mandatCourtage.findMany({
        where: { operationId },
        include: {
          courtier: { select: { id: true, societeNom: true, nom: true, prenom: true } },
          lots: { include: { lot: { select: { id: true, reference: true } } } },
          commissions: { select: { montant: true, statut: true } },
        },
        orderBy: { id: 'asc' },
      }),
    );

    return mandats.map((m) => {
      const parStatut = (statut: CommissionStatut) =>
        m.commissions
          .filter((c) => c.statut === statut)
          .reduce<Prisma.Decimal>((total, c) => total.plus(c.montant), ZERO);

      return {
        ...m,
        totaux: {
          due: parStatut('DUE').toFixed(2),
          facturee: parStatut('FACTUREE').toFixed(2),
          payee: parStatut('PAYEE').toFixed(2),
          // Les annulées sont comptées à part : les fondre dans le reste
          // ferait disparaître une commission qu'on a décidé de ne pas payer,
          // alors que c'est justement ce qu'on veut pouvoir expliquer.
          annulee: parStatut('ANNULEE').toFixed(2),
        },
      };
    });
  }

  async creerMandat(
    operationId: number,
    donnees: {
      courtierActeurId: number;
      commissionType?: 'POURCENTAGE' | 'FORFAIT';
      commissionPct?: Prisma.Decimal | null;
      commissionForfait?: Prisma.Decimal | null;
      assietteTtc?: boolean;
      perimetre?: 'TOUTE_OPERATION' | 'LOTS_SELECTIONNES';
      exclusif?: boolean;
      dateSignature?: Date | null;
      notes?: string | null;
      lotIds?: number[];
    },
  ) {
    const perimetre = donnees.perimetre ?? 'TOUTE_OPERATION';
    const commissionType = donnees.commissionType ?? 'POURCENTAGE';
    const lotIds = donnees.lotIds ?? [];

    if (commissionType === 'POURCENTAGE' && !donnees.commissionPct) {
      throw new BadRequestException('Un mandat au pourcentage exige un taux de commission.');
    }
    if (commissionType === 'FORFAIT' && !donnees.commissionForfait) {
      throw new BadRequestException('Un mandat au forfait exige un montant.');
    }
    if (perimetre === 'LOTS_SELECTIONNES' && lotIds.length === 0) {
      // Une liste vide ne couvrirait aucun lot : autant ne pas signer.
      throw new BadRequestException(
        'Un périmètre « lots sélectionnés » sans lot ne couvre rien. Indiquer les lots, ou choisir « toute l’opération ».',
      );
    }

    return this.db.run(async (tx) => {
      const courtier = await tx.acteur.findUnique({
        where: { id: donnees.courtierActeurId },
        select: { id: true, type: true, societeNom: true },
      });
      if (!courtier) {
        throw new NotFoundException(`Acteur ${donnees.courtierActeurId} introuvable.`);
      }

      await this.exigerLotsDeLOperation(tx, operationId, lotIds);
      await this.refuserConflitExclusivite(tx, operationId, {
        exclusif: donnees.exclusif ?? false,
        perimetre,
        lotIds,
      });

      const mandat = await tx.mandatCourtage.create({
        data: {
          operationId,
          courtierActeurId: donnees.courtierActeurId,
          commissionType,
          commissionPct: donnees.commissionPct ?? null,
          commissionForfait: donnees.commissionForfait ?? null,
          assietteTtc: donnees.assietteTtc ?? false,
          perimetre,
          exclusif: donnees.exclusif ?? false,
          dateSignature: donnees.dateSignature ?? null,
          notes: donnees.notes ?? null,
          lots: { create: lotIds.map((lotId) => ({ lotId })) },
        },
        include: { lots: true },
      });

      await this.audit.enregistrer(tx, {
        action: 'mandat_courtage.cree',
        entite: 'MandatCourtage',
        entiteId: mandat.id,
        donnees: {
          operationId,
          courtier: courtier.societeNom,
          commissionType,
          perimetre,
          exclusif: mandat.exclusif,
          lots: lotIds.length,
        },
      });

      return mandat;
    });
  }

  async changerStatutMandat(operationId: number, mandatId: number, statut: MandatStatut) {
    return this.db.run(async (tx) => {
      const mandat = await tx.mandatCourtage.findFirst({
        where: { id: mandatId, operationId },
        include: { lots: { select: { lotId: true } }, _count: { select: { commissions: true } } },
      });
      if (!mandat) throw new NotFoundException(`Mandat ${mandatId} introuvable.`);

      // On ne remet pas en vigueur un mandat sans revérifier l'exclusivité :
      // un autre a pu être signé entre-temps sur les mêmes lots.
      if (
        MANDATS_EN_VIGUEUR.includes(statut as (typeof MANDATS_EN_VIGUEUR)[number]) &&
        !MANDATS_EN_VIGUEUR.includes(mandat.statut as (typeof MANDATS_EN_VIGUEUR)[number])
      ) {
        await this.refuserConflitExclusivite(
          tx,
          operationId,
          {
            exclusif: mandat.exclusif,
            perimetre: mandat.perimetre,
            lotIds: mandat.lots.map((l) => l.lotId),
          },
          mandatId,
        );
      }

      if (statut === 'RESILIE' && mandat._count.commissions > 0) {
        // Résilier n'efface pas ce qui est dû : on l'autorise, mais on le dit.
        await this.audit.enregistrer(tx, {
          action: 'mandat_courtage.resilie_avec_commissions',
          entite: 'MandatCourtage',
          entiteId: mandatId,
          donnees: { operationId, commissions: mandat._count.commissions },
        });
      }

      return tx.mandatCourtage.update({ where: { id: mandatId }, data: { statut } });
    });
  }

  // ===================================================================
  //  Commissions
  // ===================================================================

  /**
   * Constate les commissions dues sur une vente.
   *
   * Idempotent par unicité applicative : on ne recrée pas une commission déjà
   * constatée pour le couple (mandat, réservation). Le schéma ne porte pas
   * cette contrainte — on la tient donc ici, et le test la vérifie.
   *
   * Ne s'applique qu'aux réservations **engagées** : une option n'est pas une
   * vente, et une commission constatée dessus serait à annuler dès que
   * l'acquéreur renonce.
   */
  async constaterCommissions(operationId: number, reservationId: number) {
    return this.db.run(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, operationId },
        select: {
          id: true,
          lotId: true,
          statut: true,
          prixTotalActe: true,
          lot: { select: { reference: true } },
        },
      });
      if (!reservation) throw new NotFoundException(`Réservation ${reservationId} introuvable.`);

      if (!['RESERVE', 'FONDS_VERSES', 'VENDU'].includes(reservation.statut)) {
        throw new BadRequestException(
          `La réservation est au statut ${reservation.statut} : aucune commission n'est due ` +
            "tant que l'acquéreur n'est pas engagé.",
        );
      }

      const mandats = await tx.mandatCourtage.findMany({
        where: { operationId, statut: { in: [...MANDATS_EN_VIGUEUR] } },
        include: {
          lots: { select: { lotId: true } },
          courtier: { select: { societeNom: true } },
          commissions: { where: { reservationId }, select: { id: true } },
        },
      });

      const creees: {
        mandatId: number;
        courtier: string | null;
        montant: string;
        motif: string;
      }[] = [];
      const ignores: { mandatId: number; raison: string }[] = [];

      for (const mandat of mandats) {
        if (
          !mandatCouvre(
            { perimetre: mandat.perimetre, lotIds: mandat.lots.map((l) => l.lotId) },
            reservation.lotId,
          )
        ) {
          continue;
        }
        if (mandat.commissions.length > 0) {
          ignores.push({ mandatId: mandat.id, raison: 'Commission déjà constatée.' });
          continue;
        }

        const commission = calculerCommission(mandat, reservation.prixTotalActe);
        const creee = await tx.commissionCourtage.create({
          data: {
            mandatCourtageId: mandat.id,
            reservationId,
            montant: commission.montant,
            note: commission.motif,
          },
        });

        await this.audit.enregistrer(tx, {
          action: 'commission_courtage.constatee',
          entite: 'CommissionCourtage',
          entiteId: creee.id,
          donnees: {
            operationId,
            mandatId: mandat.id,
            lot: reservation.lot.reference,
            montant: commission.montant,
            motif: commission.motif,
          },
        });

        creees.push({
          mandatId: mandat.id,
          courtier: mandat.courtier.societeNom,
          montant: commission.montant.toFixed(2),
          motif: commission.motif,
        });
      }

      return { lot: reservation.lot.reference, creees, ignores };
    });
  }

  async changerStatutCommission(
    operationId: number,
    commissionId: number,
    donnees: { statut: CommissionStatut; dateDue?: Date | null },
  ) {
    return this.db.run(async (tx) => {
      const commission = await tx.commissionCourtage.findFirst({
        where: { id: commissionId, mandatCourtage: { operationId } },
        select: { id: true, statut: true, montant: true },
      });
      if (!commission) throw new NotFoundException(`Commission ${commissionId} introuvable.`);

      const misAJour = await tx.commissionCourtage.update({
        where: { id: commissionId },
        data: donnees,
      });

      await this.audit.enregistrer(tx, {
        action: 'commission_courtage.statut',
        entite: 'CommissionCourtage',
        entiteId: commissionId,
        donnees: {
          operationId,
          de: commission.statut,
          vers: donnees.statut,
          montant: commission.montant,
        },
      });

      return misAJour;
    });
  }

  async listerCommissions(operationId: number) {
    return this.db.run((tx) =>
      tx.commissionCourtage.findMany({
        where: { mandatCourtage: { operationId } },
        include: {
          mandatCourtage: {
            select: {
              id: true,
              courtier: { select: { societeNom: true, nom: true, prenom: true } },
            },
          },
          reservation: {
            select: {
              id: true,
              lot: { select: { reference: true } },
              acquereur: { select: { nom: true, prenom: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      }),
    );
  }

  // ===================================================================
  //  Contrôles
  // ===================================================================

  private async exigerLotsDeLOperation(
    tx: TenantDb,
    operationId: number,
    lotIds: number[],
  ): Promise<void> {
    if (lotIds.length === 0) return;
    const trouves = await tx.lot.count({
      where: { id: { in: lotIds }, bien: { operationId } },
    });
    if (trouves !== lotIds.length) {
      // La RLS garantit le bon tenant, pas la bonne opération : sans ce
      // contrôle, un mandat couvrirait des lots d'une autre promotion.
      throw new NotFoundException("Un ou plusieurs lots n'appartiennent pas à cette opération.");
    }
  }

  private async refuserConflitExclusivite(
    tx: TenantDb,
    operationId: number,
    candidat: { exclusif: boolean; perimetre: string; lotIds: number[] },
    exclureMandatId?: number,
  ): Promise<void> {
    const existants = await tx.mandatCourtage.findMany({
      where: {
        operationId,
        statut: { in: [...MANDATS_EN_VIGUEUR] },
        ...(exclureMandatId ? { id: { not: exclureMandatId } } : {}),
      },
      include: { lots: { select: { lotId: true } } },
    });

    const conflit = conflitExclusivite(
      candidat,
      existants.map((m) => ({
        id: m.id,
        exclusif: m.exclusif,
        perimetre: m.perimetre,
        lotIds: m.lots.map((l) => l.lotId),
      })),
    );

    if (conflit) {
      throw new BadRequestException(
        `Exclusivité en conflit avec le mandat ${conflit.mandatId}` +
          (conflit.lotsEnConflit.length > 0
            ? ` sur ${conflit.lotsEnConflit.length} lot(s).`
            : ' (périmètre couvrant toute l’opération).') +
          ' Deux exclusivités sur un même lot, c’est une commission payée deux fois.',
      );
    }
  }
}
