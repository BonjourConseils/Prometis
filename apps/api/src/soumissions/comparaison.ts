import { Prisma, type OffreStatut } from '@prisma/client';

/**
 * Comparaison des offres d'une soumission.
 *
 * C'est l'écran sur lequel se prend la décision d'adjudication. Il doit
 * répondre à trois questions, dans cet ordre : qui est le moins-disant, de
 * combien les autres s'en écartent, et où se situe-t-on par rapport au budget.
 *
 * ⚠️ **Notation multicritère non persistée.** Le plan prévoit une notation
 * pondérée (prix, références, délais). `Offre` ne porte aucun champ de score :
 * seul le prix est objectivable ici. Les critères subjectifs demanderaient
 * une extension du modèle de données — décision à prendre, pas à improviser.
 * En attendant, la note ci-dessous est une **note de prix**, et elle est
 * nommée comme telle.
 */

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal(100);

export interface OffreSource {
  id: number;
  entrepriseId: number;
  entrepriseNom: string;
  montant: Prisma.Decimal | null;
  remisePct: Prisma.Decimal | null;
  statut: OffreStatut;
  dateReception: Date | null;
}

export interface OffreComparee {
  id: number;
  entrepriseId: number;
  entrepriseNom: string;
  statut: OffreStatut;
  dateReception: Date | null;
  montantBrut: Prisma.Decimal | null;
  remisePct: Prisma.Decimal | null;
  /** Montant brut diminué de la remise — la seule base comparable. */
  montantNet: Prisma.Decimal | null;
  /** Rang par prix croissant. `null` si l'offre n'est pas comparable. */
  rang: number | null;
  /** Surcoût par rapport au moins-disant, en pourcentage. */
  ecartMoinsDisantPct: Prisma.Decimal | null;
  /** Net − budgété. Négatif = sous le budget. */
  ecartBudget: Prisma.Decimal | null;
  ecartBudgetPct: Prisma.Decimal | null;
  /** 100 pour le moins-disant, décroissante ensuite. Prix uniquement. */
  notePrix: Prisma.Decimal | null;
  /** Pourquoi l'offre n'entre pas dans le classement. */
  motifExclusion: string | null;
}

export interface Comparaison {
  offres: OffreComparee[];
  /** Offres réellement comparables (prix connu, non écartée). */
  nombreComparables: number;
  moinsDisant: Prisma.Decimal | null;
  plusDisant: Prisma.Decimal | null;
  /** Écart entre le plus haut et le plus bas — la dispersion du marché. */
  dispersion: Prisma.Decimal | null;
  dispersionPct: Prisma.Decimal | null;
  budgete: Prisma.Decimal | null;
  /**
   * Offre proposée à l'adjudication : le moins-disant comparable.
   * `null` si rien n'est comparable. Ce n'est qu'une **proposition** — la
   * décision reste humaine, et une offre plus chère peut être retenue.
   */
  propositionOffreId: number | null;
}

function motifExclusion(offre: OffreSource): string | null {
  if (offre.statut === 'ECARTEE') return 'Offre écartée';
  if (offre.montant === null) return 'Prix non reçu';
  if (offre.montant.lessThanOrEqualTo(0)) return 'Montant invalide';
  return null;
}

function net(offre: OffreSource): Prisma.Decimal | null {
  if (offre.montant === null) return null;
  const remise = offre.remisePct ?? ZERO;
  return offre.montant.times(CENT.minus(remise)).dividedBy(CENT).toDecimalPlaces(2);
}

export function comparerOffres(offres: OffreSource[], budgete: Prisma.Decimal | null): Comparaison {
  const evaluees = offres.map((offre) => ({
    source: offre,
    exclusion: motifExclusion(offre),
    net: net(offre),
  }));

  const comparables = evaluees.filter((e) => e.exclusion === null && e.net !== null);
  const montants = comparables.map((e) => e.net!);

  const moinsDisant = montants.length
    ? montants.reduce((min, m) => (m.lessThan(min) ? m : min))
    : null;
  const plusDisant = montants.length
    ? montants.reduce((max, m) => (m.greaterThan(max) ? m : max))
    : null;

  // Classement par prix croissant, à égalité l'offre reçue en premier passe
  // devant — un départage arbitraire mais stable vaut mieux qu'un ordre qui
  // change d'un rafraîchissement à l'autre.
  const classement = [...comparables].sort((a, b) => {
    const parPrix = a.net!.comparedTo(b.net!);
    if (parPrix !== 0) return parPrix;
    const da = a.source.dateReception?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = b.source.dateReception?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db || a.source.id - b.source.id;
  });

  const rangParOffre = new Map(classement.map((e, i) => [e.source.id, i + 1]));

  const resultat: OffreComparee[] = evaluees.map((e) => {
    const comparable = e.exclusion === null && e.net !== null;

    return {
      id: e.source.id,
      entrepriseId: e.source.entrepriseId,
      entrepriseNom: e.source.entrepriseNom,
      statut: e.source.statut,
      dateReception: e.source.dateReception,
      montantBrut: e.source.montant,
      remisePct: e.source.remisePct,
      montantNet: e.net,
      rang: comparable ? (rangParOffre.get(e.source.id) ?? null) : null,
      ecartMoinsDisantPct:
        comparable && moinsDisant && !moinsDisant.isZero()
          ? e.net!.minus(moinsDisant).dividedBy(moinsDisant).times(CENT).toDecimalPlaces(2)
          : null,
      ecartBudget: comparable && budgete ? e.net!.minus(budgete) : null,
      ecartBudgetPct:
        comparable && budgete && !budgete.isZero()
          ? e.net!.minus(budgete).dividedBy(budgete).times(CENT).toDecimalPlaces(2)
          : null,
      notePrix:
        comparable && moinsDisant && !e.net!.isZero()
          ? moinsDisant.dividedBy(e.net!).times(CENT).toDecimalPlaces(1)
          : null,
      motifExclusion: e.exclusion,
    };
  });

  return {
    offres: resultat,
    nombreComparables: comparables.length,
    moinsDisant,
    plusDisant,
    dispersion: moinsDisant && plusDisant ? plusDisant.minus(moinsDisant) : null,
    dispersionPct:
      moinsDisant && plusDisant && !moinsDisant.isZero()
        ? plusDisant.minus(moinsDisant).dividedBy(moinsDisant).times(CENT).toDecimalPlaces(2)
        : null,
    budgete,
    propositionOffreId: classement[0]?.source.id ?? null,
  };
}
