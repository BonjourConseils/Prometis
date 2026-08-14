import { Prisma } from '@prisma/client';

/**
 * Rapprochement d'une facture avec un contrat, et proposition d'imputation CFC.
 *
 * C'est le coeur de la promesse « l'IA propose un CFC » : la lecture du texte
 * est déléguée, mais **le rapprochement métier nous appartient**, et c'est lui
 * qui fait gagner du temps au comptable.
 *
 * Rien n'est imputé automatiquement. La fonction produit une proposition et
 * un **motif lisible** : un comptable qui ne comprend pas pourquoi un CFC est
 * proposé ne fera pas confiance à la proposition, et la vérifiera à la main —
 * ce qui annule le gain.
 */

const ZERO = new Prisma.Decimal(0);

export interface CandidatContrat {
  contratId: number;
  reference: string | null;
  entrepriseId: number;
  entrepriseNom: string;
  cfcNodeId: number | null;
  /** Contrat + avenants. */
  montantCommande: Prisma.Decimal;
  /** Factures déjà validées ou payées sur ce contrat, hors taxe. */
  dejaFacture: Prisma.Decimal;
}

export interface IndicesFacture {
  fournisseurNom: string | null;
  montantHT: Prisma.Decimal | null;
  /** Texte brut, pour y chercher une référence de contrat. */
  texte: string | null;
  /** Entreprise déjà renseignée à la main : elle prime sur toute heuristique. */
  entrepriseId: number | null;
}

export interface Suggestion {
  contratId: number | null;
  cfcNodeId: number | null;
  entrepriseId: number | null;
  /** 0 à 100. Au-dessous de 50, la proposition est indicative. */
  confiance: Prisma.Decimal;
  motif: string;
}

const AUCUNE: Suggestion = {
  contratId: null,
  cfcNodeId: null,
  entrepriseId: null,
  confiance: ZERO,
  motif: 'Aucun contrat ne correspond : imputation à saisir à la main.',
};

/**
 * Normalise une raison sociale pour la comparaison.
 * « Plâtrerie Dubois SA » et « platrerie dubois s.a. » doivent se rencontrer.
 */
/** Formes juridiques suisses et voisines, à ignorer dans la comparaison. */
const FORMES_JURIDIQUES = /\b(sa|sarl|sagl|ag|gmbh|snc|scm|se|cie|succ)\b/g;

export function normaliserNom(nom: string): string {
  return (
    nom
      .normalize('NFD')
      // Diacritiques combinantes (U+0300 à U+036F).
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Les points partent en premier, sinon « s.a. » devient « s a » et
      // échappe au dépouillement des formes juridiques.
      .replace(/\./g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(FORMES_JURIDIQUES, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Deux noms se correspondent si l'un contient l'autre après normalisation. */
function nomsCorrespondent(a: string, b: string): boolean {
  const na = normaliserNom(a);
  const nb = normaliserNom(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

const dec = (n: number) => new Prisma.Decimal(n);

export function suggererImputation(
  indices: IndicesFacture,
  candidats: CandidatContrat[],
): Suggestion {
  if (candidats.length === 0) return AUCUNE;

  const proposer = (c: CandidatContrat, confiance: number, motif: string): Suggestion => ({
    contratId: c.contratId,
    cfcNodeId: c.cfcNodeId,
    entrepriseId: c.entrepriseId,
    confiance: dec(confiance),
    motif,
  });

  // 1. Référence de contrat citée dans la facture — le signal le plus fort.
  if (indices.texte) {
    const texte = indices.texte.toLowerCase();
    const cite = candidats.find((c) => c.reference && texte.includes(c.reference.toLowerCase()));
    if (cite) {
      return proposer(cite, 98, `La facture cite la référence du contrat ${cite.reference}.`);
    }
  }

  // 2. Entreprise déjà identifiée (saisie humaine ou rapprochement antérieur).
  const parEntreprise = indices.entrepriseId
    ? candidats.filter((c) => c.entrepriseId === indices.entrepriseId)
    : [];

  // 3. Sinon, rapprochement du nom du fournisseur avec le répertoire.
  const parNom =
    parEntreprise.length === 0 && indices.fournisseurNom
      ? candidats.filter((c) => nomsCorrespondent(c.entrepriseNom, indices.fournisseurNom!))
      : [];

  const retenus = parEntreprise.length > 0 ? parEntreprise : parNom;
  const origine = parEntreprise.length > 0 ? "l'entreprise renseignée" : 'le nom du fournisseur';

  if (retenus.length === 1) {
    const seul = retenus[0]!;
    return proposer(
      seul,
      90,
      `Un seul contrat pour ${seul.entrepriseNom}, rapproché par ${origine}.`,
    );
  }

  if (retenus.length > 1) {
    // Plusieurs contrats pour le même fournisseur : on départage par le reste
    // à facturer. Celui qui peut absorber le montant est le plus plausible.
    if (indices.montantHT) {
      const absorbants = retenus.filter((c) =>
        c.montantCommande.minus(c.dejaFacture).greaterThanOrEqualTo(indices.montantHT!),
      );
      if (absorbants.length === 1) {
        const seul = absorbants[0]!;
        return proposer(
          seul,
          70,
          `${retenus.length} contrats pour ${seul.entrepriseNom} ; un seul a un reste à facturer suffisant.`,
        );
      }
    }
    const premier = retenus[0]!;
    return proposer(
      premier,
      45,
      `${retenus.length} contrats pour ${premier.entrepriseNom} : proposition indicative, à confirmer.`,
    );
  }

  // 4. Fournisseur inconnu, mais un montant qui correspond exactement au
  //    reste à facturer d'un seul contrat : signal faible mais utile.
  if (indices.montantHT) {
    const exacts = candidats.filter((c) =>
      c.montantCommande.minus(c.dejaFacture).equals(indices.montantHT!),
    );
    if (exacts.length === 1) {
      const seul = exacts[0]!;
      return proposer(
        seul,
        40,
        `Le montant correspond exactement au solde du contrat de ${seul.entrepriseNom}.`,
      );
    }
  }

  return AUCUNE;
}

// =====================================================================
//  Contrôle « facturé cumulé ≤ commandé »
// =====================================================================

export interface ControleCumul {
  commande: Prisma.Decimal;
  dejaFacture: Prisma.Decimal;
  cumulApres: Prisma.Decimal;
  resteAFacturer: Prisma.Decimal;
  /** Positif = dépassement. */
  depassement: Prisma.Decimal;
  depasse: boolean;
}

/**
 * Contrôle bloquant de la Definition of Done : le cumul facturé sur un contrat
 * ne peut pas dépasser le commandé (contrat + avenants).
 *
 * Un dépassement n'est pas une erreur de saisie du comptable : c'est soit un
 * avenant qui manque, soit une facture en trop. Dans les deux cas, il faut
 * s'arrêter et regarder, pas laisser passer.
 */
export function controlerCumul(
  commande: Prisma.Decimal,
  dejaFacture: Prisma.Decimal,
  montantNouvelle: Prisma.Decimal,
): ControleCumul {
  const cumulApres = dejaFacture.plus(montantNouvelle);
  const depassement = cumulApres.minus(commande);

  return {
    commande,
    dejaFacture,
    cumulApres,
    resteAFacturer: commande.minus(dejaFacture),
    depassement: depassement.greaterThan(0) ? depassement : ZERO,
    depasse: depassement.greaterThan(0),
  };
}
