import { Injectable, NotFoundException } from '@nestjs/common';
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
  nbBiens: number;
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
          _count: { select: { biens: true, parcelles: true, cfcNodes: true } },
        },
      }),
    );

    if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);
    return operation;
  }
}
