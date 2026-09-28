import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { CHF_PAR_CREDIT, USD_EN_CHF, enFrancs, type Devise } from './couts';

const ZERO = new Prisma.Decimal(0);

/**
 * Ce que l'IA a coûté — lu directement sur le journal des appels.
 *
 * Deux règles de lecture, apprises ailleurs :
 *   · les **moyennes ne portent que sur les succès** — un échec n'a ni jetons
 *     ni coût, et tirerait tout vers zéro ;
 *   · les **totaux ne mélangent jamais deux devises**. Un équivalent en francs
 *     est donné à part, au taux du jour retenu, pour pouvoir comparer.
 */
@Injectable()
export class UsageIaService {
  constructor(private readonly db: TenantPrismaService) {}

  async statistiques(jours: number) {
    const societeId = RequestContext.requireSocieteId();
    const depuis = new Date(Date.now() - jours * 24 * 3600 * 1000);

    return this.db.runInTenant(societeId, async (tx) => {
      const appels = await tx.appelIa.findMany({
        where: { createdAt: { gte: depuis } },
        select: {
          usage: true,
          etage: true,
          fournisseur: true,
          modele: true,
          tokensEntree: true,
          tokensSortie: true,
          cout: true,
          devise: true,
          credits: true,
          dureeMs: true,
          succes: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const groupes = new Map<string, typeof appels>();
      for (const a of appels) {
        const cle = `${a.usage}|${a.modele}`;
        groupes.set(cle, [...(groupes.get(cle) ?? []), a]);
      }

      const lignes = [...groupes.values()].map((liste) => {
        const succes = liste.filter((a) => a.succes);
        const moyenne = (valeurs: number[]) =>
          valeurs.length ? valeurs.reduce((t, v) => t + v, 0) / valeurs.length : 0;
        const total = succes.reduce<Prisma.Decimal>((t, a) => t.plus(a.cout ?? 0), ZERO);
        return {
          usage: liste[0]!.usage,
          etage: liste[0]!.etage,
          fournisseur: liste[0]!.fournisseur,
          modele: liste[0]!.modele,
          appels: liste.length,
          echecs: liste.length - succes.length,
          devise: liste[0]!.devise,
          coutTotal: total.toFixed(4),
          creditsTotal: succes.reduce((t, a) => t + a.credits, 0),
          jetonsEntree: Math.round(moyenne(succes.map((a) => a.tokensEntree ?? 0))),
          jetonsSortie: Math.round(moyenne(succes.map((a) => a.tokensSortie ?? 0))),
          dureeMoyenneMs: Math.round(moyenne(succes.map((a) => a.dureeMs))),
        };
      });
      lignes.sort((a, b) => Number(b.coutTotal) - Number(a.coutTotal));

      // Par devise, jamais additionnées : les francs d'Infomaniak et les
      // dollars de Perplexity ne se mélangent pas dans une colonne.
      const parDevise = new Map<string, { cout: Prisma.Decimal; appels: number }>();
      for (const a of appels.filter((x) => x.succes)) {
        const actuel = parDevise.get(a.devise) ?? { cout: ZERO, appels: 0 };
        parDevise.set(a.devise, {
          cout: actuel.cout.plus(a.cout ?? 0),
          appels: actuel.appels + 1,
        });
      }

      return {
        jours,
        appels: appels.length,
        echecs: appels.filter((a) => !a.succes).length,
        credits: appels.reduce((t, a) => t + a.credits, 0),
        chfParCredit: CHF_PAR_CREDIT,
        tauxUsdChf: USD_EN_CHF,
        totaux: [...parDevise.entries()].map(([devise, v]) => ({
          devise,
          appels: v.appels,
          cout: v.cout.toFixed(4),
          equivalentChf: enFrancs(Number(v.cout), devise as Devise).toFixed(4),
        })),
        lignes,
      };
    });
  }
}
