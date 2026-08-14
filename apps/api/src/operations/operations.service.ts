import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AccessService } from '../auth/access.service';

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
  ) {}

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

  /** Acteurs rattachés à l'opération. Le module ACTEURS est exigé par le guard. */
  async acteurs(operationId: number) {
    return this.db.run((tx) =>
      tx.operationActeur.findMany({
        where: { operationId },
        select: {
          id: true,
          role: true,
          estMandataireGeneral: true,
          suitLeProjet: true,
          montantMandat: true,
          acteur: {
            select: {
              id: true,
              type: true,
              societeNom: true,
              nom: true,
              prenom: true,
              email: true,
            },
          },
        },
        orderBy: { ordre: 'asc' },
      }),
    );
  }
}
