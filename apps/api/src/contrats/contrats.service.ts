import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ContratStatut } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';

const CENT = new Prisma.Decimal(100);

/** Délai de garantie SIA 118 : deux ans à compter de la réception. */
const ANNEES_GARANTIE = 2;

export interface DonneesContrat {
  reference?: string | null;
  retenueGarantiePct?: Prisma.Decimal | null;
  dateSignature?: Date | null;
}

export interface DonneesAvenant {
  cfcNodeId?: number | null;
  reference?: string | null;
  montant: Prisma.Decimal;
  motif?: string | null;
  /** Non nullable en base : omettre pour laisser la date du jour. */
  dateAvenant?: Date;
}

@Injectable()
export class ContratsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private async contratDeLOperation(tx: TenantDb, operationId: number, contratId: number) {
    const contrat = await tx.contrat.findFirst({
      where: { id: contratId, operationId },
      select: {
        id: true,
        reference: true,
        montant: true,
        statut: true,
        dateReception: true,
        entreprise: { select: { nom: true } },
      },
    });
    if (!contrat) {
      throw new NotFoundException(`Contrat ${contratId} introuvable dans cette opération.`);
    }
    return contrat;
  }

  // ===================================================================
  //  Adjudication
  // ===================================================================

  /**
   * Adjuge une soumission à une offre.
   *
   * Action sensible au sens de la Definition of Done : elle engage la société
   * et alimente la colonne « adjugé » du budget CFC. Elle est auditée, et
   * elle bascule d'un coup tous les statuts — soumission adjugée, offre
   * retenue, autres offres écartées — pour qu'aucun état intermédiaire
   * incohérent ne subsiste.
   *
   * Le montant retenu est le **net après remise**, pas le montant brut : c'est
   * lui qui figurera au contrat.
   */
  async adjuger(
    operationId: number,
    soumissionId: number,
    donnees: { offreId: number; commentaire?: string | null },
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;

    return this.db.run(async (tx) => {
      const soumission = await tx.soumission.findFirst({
        where: { id: soumissionId, operationId },
        include: { adjudication: { select: { id: true } } },
      });
      if (!soumission) {
        throw new NotFoundException(`Soumission ${soumissionId} introuvable dans cette opération.`);
      }
      if (soumission.adjudication) {
        throw new BadRequestException(
          'Cette soumission est déjà adjugée. Annuler l’adjudication existante avant d’en prononcer une autre.',
        );
      }

      const offre = await tx.offre.findFirst({
        where: { id: donnees.offreId, soumissionId },
        include: { entreprise: { select: { id: true, nom: true } } },
      });
      if (!offre) {
        throw new NotFoundException(`Offre ${donnees.offreId} introuvable sur cette soumission.`);
      }
      if (offre.montant === null || offre.montant.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          "Cette offre n'a pas de montant : elle ne peut pas être adjugée.",
        );
      }

      const montantAdjuge = offre.montant
        .times(CENT.minus(offre.remisePct ?? 0))
        .dividedBy(CENT)
        .toDecimalPlaces(2);

      const adjudication = await tx.adjudication.create({
        data: {
          soumissionId,
          offreId: offre.id,
          montantAdjuge,
          decidePar: membershipId,
          commentaire: donnees.commentaire ?? null,
        },
      });

      await tx.soumission.update({ where: { id: soumissionId }, data: { statut: 'ADJUGEE' } });
      await tx.offre.update({ where: { id: offre.id }, data: { statut: 'RETENUE' } });
      await tx.offre.updateMany({
        where: { soumissionId, NOT: { id: offre.id } },
        data: { statut: 'ECARTEE' },
      });

      await this.audit.enregistrer(tx, {
        action: 'adjudication.prononcee',
        entite: 'Adjudication',
        entiteId: adjudication.id,
        donnees: {
          operationId,
          soumissionId,
          intitule: soumission.intitule,
          entreprise: offre.entreprise.nom,
          montantBrut: offre.montant,
          remisePct: offre.remisePct,
          montantAdjuge,
          commentaire: donnees.commentaire ?? null,
        },
      });

      return adjudication;
    });
  }

  /**
   * Annule une adjudication et rouvre la comparaison.
   *
   * Refusée si un contrat en découle : le contrat est l'engagement, et le
   * défaire suppose de le résilier explicitement, pas de retirer la décision
   * qui l'a produit.
   */
  async annulerAdjudication(operationId: number, adjudicationId: number) {
    return this.db.run(async (tx) => {
      const adjudication = await tx.adjudication.findFirst({
        where: { id: adjudicationId, soumission: { operationId } },
        include: {
          contrat: { select: { id: true, reference: true } },
          soumission: { select: { id: true, intitule: true } },
        },
      });
      if (!adjudication) {
        throw new NotFoundException(`Adjudication ${adjudicationId} introuvable.`);
      }
      if (adjudication.contrat) {
        throw new BadRequestException(
          `Un contrat (${adjudication.contrat.reference ?? adjudication.contrat.id}) découle de cette adjudication. ` +
            'Le résilier avant de revenir sur la décision.',
        );
      }

      await tx.adjudication.delete({ where: { id: adjudicationId } });
      await tx.soumission.update({
        where: { id: adjudication.soumissionId },
        data: { statut: 'EN_COMPARAISON' },
      });
      await tx.offre.updateMany({
        where: { soumissionId: adjudication.soumissionId },
        data: { statut: 'RECUE' },
      });

      await this.audit.enregistrer(tx, {
        action: 'adjudication.annulee',
        entite: 'Adjudication',
        entiteId: adjudicationId,
        donnees: {
          operationId,
          soumission: adjudication.soumission.intitule,
          montantAdjuge: adjudication.montantAdjuge,
        },
      });
      return { annulee: true };
    });
  }

  // ===================================================================
  //  Contrats
  // ===================================================================

  async listerContrats(operationId: number) {
    return this.db.run((tx) =>
      tx.contrat.findMany({
        where: { operationId },
        include: {
          entreprise: { select: { id: true, nom: true, corpsMetier: true } },
          cfcNode: { select: { id: true, code: true, libelle: true } },
          avenants: {
            select: { id: true, reference: true, montant: true, motif: true, dateAvenant: true },
            orderBy: { id: 'asc' },
          },
          adjudication: { select: { id: true, montantAdjuge: true } },
        },
        orderBy: { id: 'asc' },
      }),
    );
  }

  /**
   * Génère le contrat d'une adjudication.
   *
   * Le montant, l'entreprise et le poste CFC sont **repris de l'adjudication**,
   * jamais saisis : un contrat qui diverge de la décision d'adjudication
   * romprait le fil rouge entre l'adjugé et le commandé.
   */
  async creerContratDepuisAdjudication(
    operationId: number,
    adjudicationId: number,
    donnees: DonneesContrat,
  ) {
    return this.db.run(async (tx) => {
      const adjudication = await tx.adjudication.findFirst({
        where: { id: adjudicationId, soumission: { operationId } },
        include: {
          contrat: { select: { id: true } },
          offre: { select: { entrepriseId: true, entreprise: { select: { nom: true } } } },
          soumission: { select: { id: true, intitule: true, cfcNodeId: true } },
        },
      });
      if (!adjudication) {
        throw new NotFoundException(`Adjudication ${adjudicationId} introuvable.`);
      }
      if (adjudication.contrat) {
        throw new BadRequestException('Un contrat existe déjà pour cette adjudication.');
      }

      const contrat = await tx.contrat.create({
        data: {
          operationId,
          entrepriseId: adjudication.offre.entrepriseId,
          cfcNodeId: adjudication.soumission.cfcNodeId,
          adjudicationId,
          reference: donnees.reference ?? null,
          montant: adjudication.montantAdjuge,
          retenueGarantiePct: donnees.retenueGarantiePct ?? null,
          statut: donnees.dateSignature ? 'SIGNE' : 'BROUILLON',
          dateSignature: donnees.dateSignature ?? null,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'contrat.cree',
        entite: 'Contrat',
        entiteId: contrat.id,
        donnees: {
          operationId,
          soumission: adjudication.soumission.intitule,
          entreprise: adjudication.offre.entreprise.nom,
          montant: contrat.montant,
          retenueGarantiePct: contrat.retenueGarantiePct,
        },
      });
      return contrat;
    });
  }

  /**
   * Met à jour un contrat. Enregistrer la réception de l'ouvrage calcule la
   * fin du délai de garantie SIA 118 — deux ans — plutôt que de laisser
   * quelqu'un la saisir de travers.
   */
  async modifierContrat(
    operationId: number,
    contratId: number,
    donnees: {
      reference?: string | null;
      retenueGarantiePct?: Prisma.Decimal | null;
      statut?: ContratStatut;
      dateSignature?: Date | null;
      dateReception?: Date | null;
    },
  ) {
    return this.db.run(async (tx) => {
      const avant = await this.contratDeLOperation(tx, operationId, contratId);

      let finGarantie: Date | undefined;
      if (donnees.dateReception) {
        finGarantie = new Date(donnees.dateReception);
        finGarantie.setFullYear(finGarantie.getFullYear() + ANNEES_GARANTIE);
      }

      const contrat = await tx.contrat.update({
        where: { id: contratId },
        data: { ...donnees, ...(finGarantie ? { finGarantie } : {}) },
      });

      await this.audit.enregistrer(tx, {
        action: 'contrat.modifie',
        entite: 'Contrat',
        entiteId: contratId,
        donnees: {
          operationId,
          entreprise: avant.entreprise.nom,
          avantStatut: avant.statut,
          apresStatut: contrat.statut,
          finGarantie: contrat.finGarantie,
        },
      });
      return contrat;
    });
  }

  // ===================================================================
  //  Avenants
  // ===================================================================

  /**
   * Avenant en plus ou en moins.
   *
   * Le montant est signé : un travail en moins s'enregistre négatif. Il entre
   * dans le « commandé » du poste CFC, ce qui déplace le reste à engager —
   * c'est précisément ce qu'un promoteur veut voir bouger.
   */
  async creerAvenant(operationId: number, contratId: number, donnees: DonneesAvenant) {
    return this.db.run(async (tx) => {
      const contrat = await this.contratDeLOperation(tx, operationId, contratId);
      if (contrat.statut === 'RESILIE') {
        throw new BadRequestException("Ce contrat est résilié : il n'accepte plus d'avenant.");
      }
      if (donnees.montant.isZero()) {
        throw new BadRequestException("Un avenant à zéro n'a pas d'effet : montant requis.");
      }

      if (donnees.cfcNodeId) {
        const noeud = await tx.cfcNode.findFirst({
          where: { id: donnees.cfcNodeId, operationId },
          select: { id: true },
        });
        if (!noeud) throw new NotFoundException(`Poste CFC ${donnees.cfcNodeId} introuvable.`);
      }

      const avenant = await tx.avenant.create({ data: { contratId, ...donnees } });

      await this.audit.enregistrer(tx, {
        action: 'avenant.cree',
        entite: 'Avenant',
        entiteId: avenant.id,
        donnees: {
          operationId,
          contratId,
          entreprise: contrat.entreprise.nom,
          montant: avenant.montant,
          motif: avenant.motif,
        },
      });
      return avenant;
    });
  }

  async supprimerAvenant(operationId: number, avenantId: number) {
    return this.db.run(async (tx) => {
      const avenant = await tx.avenant.findFirst({
        where: { id: avenantId, contrat: { operationId } },
        select: { id: true, montant: true, contratId: true },
      });
      if (!avenant) throw new NotFoundException(`Avenant ${avenantId} introuvable.`);

      await tx.avenant.delete({ where: { id: avenantId } });
      await this.audit.enregistrer(tx, {
        action: 'avenant.supprime',
        entite: 'Avenant',
        entiteId: avenantId,
        donnees: { operationId, contratId: avenant.contratId, montant: avenant.montant },
      });
      return { supprime: true };
    });
  }
}
