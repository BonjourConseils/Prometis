import { Prisma } from '@prisma/client';

/**
 * Calcul d'une commission de courtage.
 *
 * Pur, et c'est voulu : c'est de l'argent dû à un tiers sur la foi d'un
 * mandat signé. Le calcul doit être vérifiable ligne à ligne, sans base.
 */

/** Taux de TVA suisse par défaut, en pourcentage (CLAUDE.md §4). */
export const TVA_PCT = new Prisma.Decimal('8.1');

export type TypeCommission = 'POURCENTAGE' | 'FORFAIT';

export interface Mandat {
  commissionType: TypeCommission;
  commissionPct: Prisma.Decimal | null;
  commissionForfait: Prisma.Decimal | null;
  /** La commission porte-t-elle sur le prix TTC plutôt que sur le prix HT ? */
  assietteTtc: boolean;
}

export interface Commission {
  montant: Prisma.Decimal;
  assiette: Prisma.Decimal;
  /** Explication en une phrase, reprise dans l'audit et à l'écran. */
  motif: string;
}

/**
 * Commission due sur une vente.
 *
 * Deux subtilités qui coûtent cher si on les rate :
 *
 *   1. **L'assiette.** Les prix de vente d'un lot PPE sont tenus hors taxe
 *      dans tout le produit (comme les lignes de budget). Un mandat qui
 *      stipule une commission « sur le prix de vente TTC » porte donc sur une
 *      assiette qu'il faut reconstituer, pas sur le chiffre stocké tel quel.
 *   2. **Le forfait ignore l'assiette.** Un forfait de 15 000 reste 15 000,
 *      que le lot se vende 600 000 ou 900 000 ; l'appliquer en pourcentage
 *      transformerait une commission fixe en pourcentage de trois chiffres.
 */
export function calculerCommission(
  mandat: Mandat,
  prixTotalActeHt: Prisma.Decimal | null,
): Commission {
  if (mandat.commissionType === 'FORFAIT') {
    const montant = mandat.commissionForfait;
    if (!montant) {
      throw new Error('Mandat au forfait sans montant : commission incalculable.');
    }
    return {
      montant: arrondiCentimes(montant),
      assiette: new Prisma.Decimal(0),
      motif: `Forfait contractuel de ${montant.toFixed(2)} CHF, indépendant du prix de vente.`,
    };
  }

  if (!mandat.commissionPct) {
    throw new Error('Mandat au pourcentage sans taux : commission incalculable.');
  }
  if (!prixTotalActeHt) {
    throw new Error(
      "La réservation n'a pas de prix total acte : sans assiette, aucune commission ne peut être due.",
    );
  }

  const assiette = mandat.assietteTtc
    ? prixTotalActeHt.times(TVA_PCT.dividedBy(100).plus(1))
    : prixTotalActeHt;

  const montant = assiette.times(mandat.commissionPct).dividedBy(100);

  return {
    montant: arrondiCentimes(montant),
    assiette: arrondiCentimes(assiette),
    motif:
      `${mandat.commissionPct.toFixed(2)} % de ${arrondiCentimes(assiette).toFixed(2)} CHF ` +
      (mandat.assietteTtc
        ? `(prix total acte TTC, TVA ${TVA_PCT.toFixed(1)} % incluse)`
        : '(prix total acte hors taxe)'),
  };
}

/**
 * Un mandat couvre-t-il ce lot ?
 *
 * `TOUTE_OPERATION` couvre tout ; `LOTS_SELECTIONNES` ne couvre que la liste,
 * et une liste vide ne couvre **rien**. Traiter la liste vide comme « tout »
 * ferait naître des commissions sur des lots qu'aucun courtier n'a vendus.
 */
export function mandatCouvre(
  mandat: { perimetre: 'TOUTE_OPERATION' | 'LOTS_SELECTIONNES'; lotIds: number[] },
  lotId: number,
): boolean {
  if (mandat.perimetre === 'TOUTE_OPERATION') return true;
  return mandat.lotIds.includes(lotId);
}

/** Statuts de mandat sous lesquels une commission peut naître. */
export const MANDATS_EN_VIGUEUR = ['SIGNE', 'ACTIF'] as const;

/**
 * Vérifie qu'un lot n'est pas couvert par deux mandats exclusifs.
 *
 * Deux exclusivités sur le même lot, c'est une commission payée deux fois, ou
 * un litige. Mieux vaut le refuser à la signature du second mandat que le
 * découvrir à la vente.
 */
export function conflitExclusivite(
  candidat: { exclusif: boolean; lotIds: number[]; perimetre: string },
  existants: { id: number; exclusif: boolean; lotIds: number[]; perimetre: string }[],
): { mandatId: number; lotsEnConflit: number[] } | null {
  for (const existant of existants) {
    if (!candidat.exclusif && !existant.exclusif) continue;

    const candidatTout = candidat.perimetre === 'TOUTE_OPERATION';
    const existantTout = existant.perimetre === 'TOUTE_OPERATION';

    if (candidatTout || existantTout) {
      // Un périmètre « toute l'opération » recouvre par définition les lots de
      // l'autre : on signale sans chercher plus loin.
      return { mandatId: existant.id, lotsEnConflit: [] };
    }

    const communs = candidat.lotIds.filter((id) => existant.lotIds.includes(id));
    if (communs.length > 0) return { mandatId: existant.id, lotsEnConflit: communs };
  }
  return null;
}

/** Arrondi au centime, mode commercial — celui d'une facture suisse. */
function arrondiCentimes(valeur: Prisma.Decimal): Prisma.Decimal {
  return valeur.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
