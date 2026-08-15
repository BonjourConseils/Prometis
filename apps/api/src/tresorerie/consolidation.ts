import { Prisma } from '@prisma/client';

/**
 * Consolidation de trésorerie : ce qui est réellement entré et sorti.
 *
 * Une mise en garde, parce qu'elle va à l'encontre du reste du produit : le
 * budget, les adjudications et les factures sont tenus **hors taxe**, et tout
 * le code s'emploie à ne jamais mélanger HT et TTC. Ici, c'est différent — on
 * additionne des **mouvements de caisse**, et un virement bancaire ne connaît
 * pas la TVA. Les montants sont donc pris tels qu'ils ont transité.
 *
 * D'où la règle : cette vue ne se compare pas au budget CFC. Elle répond à
 * « ai-je de quoi payer la prochaine situation ? », pas à « suis-je dans mon
 * budget ? » — question à laquelle répond l'écran Écarts.
 */

const ZERO = new Prisma.Decimal(0);

export type SensMouvement = 'ENCAISSEMENT' | 'DECAISSEMENT';

export interface Mouvement {
  date: Date;
  montant: Prisma.Decimal;
  sens: SensMouvement;
  libelle: string;
  /** Référence lisible : n° de facture, n° d'appel de fonds. */
  reference?: string | null;
}

export interface MoisConsolide {
  /** Clé triable, format `AAAA-MM`. */
  mois: string;
  encaisse: Prisma.Decimal;
  decaisse: Prisma.Decimal;
  /** Encaissé moins décaissé sur le mois. */
  net: Prisma.Decimal;
  /** Position cumulée depuis le premier mouvement. */
  cumul: Prisma.Decimal;
  nombreMouvements: number;
}

export interface Consolidation {
  mois: MoisConsolide[];
  totalEncaisse: Prisma.Decimal;
  totalDecaisse: Prisma.Decimal;
  position: Prisma.Decimal;
  /** Mois où la position cumulée est au plus bas — le point de tension. */
  creux: { mois: string; position: Prisma.Decimal } | null;
}

export function cleMois(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Regroupe les mouvements par mois et calcule la position cumulée.
 *
 * Les mois **sans mouvement** sont comblés entre le premier et le dernier :
 * un tableau qui saute de mars à juillet laisse croire à une trésorerie
 * continue là où il ne s'est rien passé, et fausse la lecture du creux.
 */
export function consolider(mouvements: Mouvement[]): Consolidation {
  if (mouvements.length === 0) {
    return {
      mois: [],
      totalEncaisse: ZERO,
      totalDecaisse: ZERO,
      position: ZERO,
      creux: null,
    };
  }

  const parMois = new Map<
    string,
    { encaisse: Prisma.Decimal; decaisse: Prisma.Decimal; n: number }
  >();
  for (const mouvement of mouvements) {
    const cle = cleMois(mouvement.date);
    const agrege = parMois.get(cle) ?? { encaisse: ZERO, decaisse: ZERO, n: 0 };
    if (mouvement.sens === 'ENCAISSEMENT') {
      agrege.encaisse = agrege.encaisse.plus(mouvement.montant);
    } else {
      agrege.decaisse = agrege.decaisse.plus(mouvement.montant);
    }
    agrege.n += 1;
    parMois.set(cle, agrege);
  }

  const cles = [...parMois.keys()].sort();
  const toutesLesCles = comblerMois(cles[0]!, cles[cles.length - 1]!);

  let cumul = ZERO;
  let totalEncaisse = ZERO;
  let totalDecaisse = ZERO;
  let creux: { mois: string; position: Prisma.Decimal } | null = null;

  const mois: MoisConsolide[] = toutesLesCles.map((cle) => {
    const agrege = parMois.get(cle) ?? { encaisse: ZERO, decaisse: ZERO, n: 0 };
    const net = agrege.encaisse.minus(agrege.decaisse);
    cumul = cumul.plus(net);
    totalEncaisse = totalEncaisse.plus(agrege.encaisse);
    totalDecaisse = totalDecaisse.plus(agrege.decaisse);

    if (!creux || cumul.lessThan(creux.position)) creux = { mois: cle, position: cumul };

    return {
      mois: cle,
      encaisse: agrege.encaisse,
      decaisse: agrege.decaisse,
      net,
      cumul,
      nombreMouvements: agrege.n,
    };
  });

  return { mois, totalEncaisse, totalDecaisse, position: cumul, creux };
}

/** Toutes les clés `AAAA-MM` de `debut` à `fin`, bornes comprises. */
function comblerMois(debut: string, fin: string): string[] {
  const [anneeD, moisD] = debut.split('-').map(Number) as [number, number];
  const [anneeF, moisF] = fin.split('-').map(Number) as [number, number];

  const cles: string[] = [];
  let annee = anneeD;
  let mois = moisD;
  // Garde-fou : des dates aberrantes en base ne doivent pas produire une
  // boucle sans fin. Cent ans de mois suffisent à toute promotion.
  for (let garde = 0; garde < 1200; garde++) {
    cles.push(`${annee}-${String(mois).padStart(2, '0')}`);
    if (annee === anneeF && mois === moisF) break;
    mois += 1;
    if (mois > 12) {
      mois = 1;
      annee += 1;
    }
  }
  return cles;
}
