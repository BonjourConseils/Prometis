import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ModeRealisation, OperationStatut, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AccessService } from '../auth/access.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../context/request-context';

export interface DonneesOperation {
  nom: string;
  description?: string | null;
  commune?: string | null;
  canton?: string | null;
  parcelle?: string | null;
  statut?: OperationStatut;
  dateDebut?: Date | null;
  dateLivraisonPrevue?: Date | null;
  prixTerrain?: Prisma.Decimal | null;
  fraisNotaireTerrain?: Prisma.Decimal | null;
  droitsMutation?: Prisma.Decimal | null;
  terrainAvecBatiment?: boolean;
  modeRealisation?: ModeRealisation | null;
  notaireActeurId?: number | null;
  maitreOuvrageActeurId?: number | null;
  commercialisationActive?: boolean;
}

export interface OperationListItem {
  id: number;
  nom: string;
  statut: string;
  commune: string | null;
  canton: string | null;
  commercialisationActive: boolean;
  /** Promotion Kolabimo rattachée : une opération n'en porte qu'une. */
  kolabimoPromotionId: number | null;
  nbBiens: number;
  /** Le membre nommé direction des travaux, s'il y en a un. */
  directionTravauxId: number | null;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crée une opération et **donne d'office MANAGE à son créateur**.
   *
   * Sans cela, un chef de projet créerait une opération qu'il ne verrait pas :
   * la liste est filtrée par `OperationAccess`, et un administrateur devrait
   * lui rouvrir la porte. Le créateur d'une promotion la pilote.
   */
  async creer(donnees: DonneesOperation) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;

    return this.db.run(async (tx) => {
      const operation = await tx.operation.create({ data: { societeId, ...donnees } });

      await tx.operationAccess.create({
        data: {
          operationId: operation.id,
          membershipId,
          accessLevel: 'MANAGE',
          modules: [],
          grantedById: membershipId,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'operation.creee',
        entite: 'Operation',
        entiteId: operation.id,
        donnees: { nom: operation.nom, commune: operation.commune },
      });

      return operation;
    });
  }

  async modifier(operationId: number, donnees: Partial<DonneesOperation>) {
    return this.db.run(async (tx) => {
      const { count } = await tx.operation.updateMany({
        where: { id: operationId },
        data: donnees,
      });
      if (count === 0) throw new NotFoundException(`Opération ${operationId} introuvable.`);

      await this.audit.enregistrer(tx, {
        action: 'operation.modifiee',
        entite: 'Operation',
        entiteId: operationId,
        donnees: { champs: Object.keys(donnees) },
      });
      return tx.operation.findUniqueOrThrow({ where: { id: operationId } });
    });
  }

  /**
   * Supprime une promotion — et refuse de le faire dès qu'elle porte une
   * trace d'argent.
   *
   * Une promotion se clôture, elle ne s'efface pas : factures, contrats,
   * réservations et appels de fonds sont des pièces comptables, et leur
   * suppression ne se rattrape pas. Ce qui se supprime, ce sont les
   * promotions créées pour rien — un essai, un doublon, une démonstration.
   */
  async supprimer(operationId: number) {
    return this.db.run(async (tx) => {
      const operation = await tx.operation.findUnique({
        where: { id: operationId },
        select: {
          id: true,
          nom: true,
          _count: {
            select: {
              factures: true,
              contrats: true,
              soumissions: true,
              reservations: true,
              ordresPaiement: true,
              documents: true,
            },
          },
        },
      });
      if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);

      const appels = await tx.appelDeFonds.count({ where: { reservation: { operationId } } });

      const pieces = [
        [operation._count.factures, 'facture'],
        [operation._count.contrats, 'contrat'],
        [appels, 'appel de fonds'],
        [operation._count.ordresPaiement, 'ordre de paiement'],
        [operation._count.reservations, 'réservation'],
      ] as const;
      const bloquantes = pieces.filter(([n]) => n > 0);
      if (bloquantes.length) {
        throw new BadRequestException(
          `« ${operation.nom} » porte ${bloquantes
            .map(([n, mot]) => `${n} ${mot}${n > 1 ? 's' : ''}`)
            .join(
              ', ',
            )} : ce sont des pièces comptables. Clôturez la promotion plutôt que de la supprimer.`,
        );
      }

      // L'audit s'écrit AVANT : après la suppression, l'opération n'existe
      // plus, et la trace de ce qu'on a effacé doit rester.
      await this.audit.enregistrer(tx, {
        action: 'operation.supprimee',
        entite: 'Operation',
        entiteId: operationId,
        donnees: {
          nom: operation.nom,
          soumissions: operation._count.soumissions,
          documents: operation._count.documents,
        },
      });

      // La cascade ne suffit pas : `lignes_budget` référence `cfc_nodes` en
      // Restrict, et l'ordre d'évaluation des cascades n'est pas garanti.
      await tx.ligneBudget.deleteMany({ where: { budgetVersion: { operationId } } });
      await tx.budgetVersion.deleteMany({ where: { operationId } });
      await tx.cfcNode.deleteMany({ where: { operationId } });
      await tx.parking.deleteMany({ where: { lot: { bien: { operationId } } } });
      await tx.lot.deleteMany({ where: { bien: { operationId } } });
      await tx.operation.delete({ where: { id: operationId } });

      return { supprimee: true, nom: operation.nom };
    });
  }

  /**
   * Opérations visibles par le membership courant.
   *
   * Deux filtres empilés, et ce n'est pas redondant :
   *   · la RLS borne au tenant — c'est la garantie de non-fuite ;
   *   · `OperationAccess` borne aux opérations confiées à ce membre — c'est la
   *     règle métier, invisible de la base.
   *
   * Un OWNER ou ADMIN voit toutes les opérations de sa société sans qu'on lui
   * ait accordé de droit ligne à ligne.
   */
  async findAll(): Promise<OperationListItem[]> {
    const autorisees = await this.access.operationsAutorisees();

    return this.db.run(async (tx) => {
      const operations = await tx.operation.findMany({
        where: autorisees === 'toutes' ? {} : { id: { in: autorisees } },
        select: {
          id: true,
          nom: true,
          statut: true,
          commune: true,
          canton: true,
          commercialisationActive: true,
          kolabimoPromotionId: true,
          directionTravauxId: true,
          _count: { select: { biens: true } },
        },
        orderBy: { nom: 'asc' },
      });

      return operations.map((o) => ({
        id: o.id,
        nom: o.nom,
        statut: o.statut,
        commune: o.commune,
        canton: o.canton,
        commercialisationActive: o.commercialisationActive,
        kolabimoPromotionId: o.kolabimoPromotionId,
        directionTravauxId: o.directionTravauxId,
        nbBiens: o._count.biens,
      }));
    });
  }

  /** Le droit d'accès est vérifié par le guard sur la route. */
  async findOne(operationId: number) {
    const operation = await this.db.run((tx) =>
      tx.operation.findUnique({
        where: { id: operationId },
        select: {
          id: true,
          nom: true,
          description: true,
          commune: true,
          canton: true,
          statut: true,
          modeRealisation: true,
          commercialisationActive: true,
          dateDebut: true,
          dateLivraisonPrevue: true,
          // Sans ce champ, l'écran d'estimatif enregistrait le total des
          // ventes puis le réaffichait vide : la valeur existait en base et
          // ne revenait jamais.
          recettesPrevisionnelles: true,
          // L'écran Foncier récapitule l'assiette : prix des parcelles et
          // frais d'acquisition de l'opération.
          prixTerrain: true,
          fraisNotaireTerrain: true,
          droitsMutation: true,
          // Rattachement Kolabimo : depuis le 02.09.2026, une opération reliée
          // ne clôt plus ses jalons depuis Prometis. L'écran doit le dire, pas
          // laisser l'utilisateur découvrir un 409.
          kolabimoPromotionId: true,
          // Le compte d'où partent les paiements aux entreprises : l'écran des
          // ordres de paiement le montre et permet de le corriger.
          ibanPaiement: true,
          bicPaiement: true,
          _count: { select: { biens: true, parcelles: true, cfcNodes: true } },
        },
      }),
    );

    if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);
    return operation;
  }
}
