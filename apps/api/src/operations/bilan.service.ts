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
   *
   * Tant qu'aucun lot n'existe — à l'étude de faisabilité — le bilan retombe
   * sur les **recettes prévisionnelles** saisies sur l'opération, et le
   * signale par `recettesEstimees`. Un bilan sans recettes n'apprendrait
   * rien ; un bilan qui ferait passer une estimation pour un prix de vente
   * serait pire. Dès le premier lot saisi, ce sont les prix réels qui
   * comptent, sans exception.
   */
  async pourOperation(operationId: number): Promise<
    Bilan & {
      operation: { id: number; nom: string; commune: string | null };
      budgetVersion: { id: number; libelle: string } | null;
      /** Vrai quand les recettes sont une estimation, faute de lots saisis. */
      recettesEstimees: boolean;
    }
  > {
    const donnees = await this.db.run(async (tx) => {
      const operation = await tx.operation.findUnique({
        where: { id: operationId },
        select: {
          id: true,
          nom: true,
          commune: true,
          commercialisationActive: true,
          recettesPrevisionnelles: true,
        },
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

    // Une seule ligne de recette fictive quand le plan de vente n'existe pas
    // encore : le calcul reste le même, seule sa provenance change.
    const previsionnel = donnees.operation.recettesPrevisionnelles;
    const recettesEstimees = donnees.lots.length === 0 && previsionnel !== null;

    const recettes: LigneRecette[] = recettesEstimees
      ? [{ prixVente: previsionnel, parkings: [] }]
      : donnees.lots.map((l) => ({
          prixVente: l.prixVente,
          parkings: l.parkings.map((p) => p.prix),
        }));

    const bilan = calculerBilan(couts, recettes);

    return {
      ...bilan,
      // La recette estimée voyage dans une ligne fictive pour réutiliser le
      // calcul ; elle ne doit pas se faire passer pour un lot vendu.
      recettes: recettesEstimees ? { ...bilan.recettes, nombreLots: 0 } : bilan.recettes,
      recettesEstimees,
      operation: {
        id: donnees.operation.id,
        nom: donnees.operation.nom,
        commune: donnees.operation.commune,
      },
      budgetVersion: donnees.budgetVersion,
    };
  }
}
