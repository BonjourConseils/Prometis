import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { calculerBilan, type Bilan, type LigneCout, type LigneRecette } from './bilan';

@Injectable()
export class BilanService {
  constructor(private readonly db: TenantPrismaService) {}

  /**
   * Bilan promoteur d'une opération.
   *
   * Les coûts viennent de la version de budget **courante** — pas de la
   * somme de toutes les versions, ce qui compterait plusieurs fois le même
   * poste. Les recettes viennent des lots et de leurs parkings.
   */
  async pourOperation(operationId: number): Promise<
    Bilan & {
      operation: { id: number; nom: string; commune: string | null };
      budgetVersion: { id: number; libelle: string } | null;
    }
  > {
    const donnees = await this.db.run(async (tx) => {
      const operation = await tx.operation.findUnique({
        where: { id: operationId },
        select: { id: true, nom: true, commune: true, commercialisationActive: true },
      });
      if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);

      if (!operation.commercialisationActive) {
        // Une opération pilotée par une EG ou un architecte n'a pas de
        // recettes dans Prometis : un « bilan promoteur » y serait un
        // chiffre faux, pas une information manquante.
        throw new ForbiddenException(
          "La commercialisation est désactivée sur cette opération : elle n'a pas de bilan promoteur.",
        );
      }

      const budgetVersion = await tx.budgetVersion.findFirst({
        where: { operationId, isCourant: true },
        select: { id: true, libelle: true },
      });

      const lignes = budgetVersion
        ? await tx.ligneBudget.findMany({
            where: { budgetVersionId: budgetVersion.id },
            select: { montant: true, estReserve: true, cfcNode: { select: { code: true } } },
          })
        : [];

      const lots = await tx.lot.findMany({
        where: { bien: { operationId } },
        select: { prixVente: true, parkings: { select: { prix: true } } },
      });

      return { operation, budgetVersion, lignes, lots };
    });

    const couts: LigneCout[] = donnees.lignes.map((l) => ({
      codeCfc: l.cfcNode.code,
      montant: l.montant,
      estReserve: l.estReserve,
    }));

    const recettes: LigneRecette[] = donnees.lots.map((l) => ({
      prixVente: l.prixVente,
      parkings: l.parkings.map((p) => p.prix),
    }));

    return {
      ...calculerBilan(couts, recettes),
      operation: {
        id: donnees.operation.id,
        nom: donnees.operation.nom,
        commune: donnees.operation.commune,
      },
      budgetVersion: donnees.budgetVersion,
    };
  }
}
