import { Prisma } from '@prisma/client';

/**
 * Bilan promoteur : ce que l'opération coûte contre ce qu'elle rapporte.
 *
 * Fonction **pure**, isolée du reste : c'est le premier calcul que le
 * promoteur regarde le matin, et celui qu'il confrontera à ses propres
 * tableaux lors du pilote. Il doit être juste au centime et testable sans
 * base de données.
 *
 * Tout est en `Prisma.Decimal`. Un `parseFloat` sur un prix de lot introduit
 * des erreurs d'arrondi sur des montants à sept chiffres.
 */

export interface LigneCout {
  /** Code CFC de rattachement, pour l'agrégation par groupe principal. */
  codeCfc: string;
  montant: Prisma.Decimal;
  estReserve: boolean;
}

export interface LigneRecette {
  prixVente: Prisma.Decimal | null;
  parkings: (Prisma.Decimal | null)[];
}

export interface GroupeCout {
  /** Groupe principal CFC : « 0 » terrain, « 1 » travaux préparatoires… */
  groupe: string;
  montant: Prisma.Decimal;
}

export interface Bilan {
  couts: {
    total: Prisma.Decimal;
    /** Provisions et imprévus, isolés : ce n'est pas de la dépense engagée. */
    reserves: Prisma.Decimal;
    horsReserves: Prisma.Decimal;
    parGroupeCfc: GroupeCout[];
  };
  recettes: {
    total: Prisma.Decimal;
    lots: Prisma.Decimal;
    parkings: Prisma.Decimal;
    nombreLots: number;
  };
  marge: Prisma.Decimal;
  /** Marge rapportée aux recettes, en pourcentage. `null` si aucune recette. */
  tauxMargePct: Prisma.Decimal | null;
}

const ZERO = new Prisma.Decimal(0);

const somme = (valeurs: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal =>
  valeurs.reduce<Prisma.Decimal>((total, v) => (v ? total.plus(v) : total), ZERO);

/**
 * Groupe principal d'un code CFC : le premier segment avant le point, puis
 * son premier chiffre. « 232.1 » → « 2 », « 01 » → « 0 ».
 */
export function groupePrincipal(codeCfc: string): string {
  return (codeCfc.split('.')[0] ?? codeCfc).charAt(0);
}

export function calculerBilan(couts: LigneCout[], recettes: LigneRecette[]): Bilan {
  const totalCouts = somme(couts.map((l) => l.montant));
  const reserves = somme(couts.filter((l) => l.estReserve).map((l) => l.montant));

  const parGroupe = new Map<string, Prisma.Decimal>();
  for (const ligne of couts) {
    const groupe = groupePrincipal(ligne.codeCfc);
    parGroupe.set(groupe, (parGroupe.get(groupe) ?? ZERO).plus(ligne.montant));
  }

  const totalLots = somme(recettes.map((r) => r.prixVente));
  const totalParkings = somme(recettes.flatMap((r) => r.parkings));
  const totalRecettes = totalLots.plus(totalParkings);

  const marge = totalRecettes.minus(totalCouts);

  return {
    couts: {
      total: totalCouts,
      reserves,
      horsReserves: totalCouts.minus(reserves),
      parGroupeCfc: [...parGroupe.entries()]
        .map(([groupe, montant]) => ({ groupe, montant }))
        .sort((a, b) => a.groupe.localeCompare(b.groupe)),
    },
    recettes: {
      total: totalRecettes,
      lots: totalLots,
      parkings: totalParkings,
      nombreLots: recettes.length,
    },
    marge,
    // Un taux sur des recettes nulles n'a pas de sens : on ne renvoie pas 0,
    // qui se lirait comme « marge nulle » alors qu'il n'y a rien à vendre.
    tauxMargePct: totalRecettes.isZero()
      ? null
      : marge.dividedBy(totalRecettes).times(100).toDecimalPlaces(2),
  };
}
