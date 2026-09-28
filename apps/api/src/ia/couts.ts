/**
 * Ce que coûte un appel à un modèle, et ce qu'il vaut en crédits.
 *
 * Méthode commune au groupe (skill `appels-ia-credits`). Trois étages :
 *
 *   · **LOCAL** — Qwen 3.5 4B sur notre serveur. Trier, classer, étiqueter,
 *     extraire trois champs d'un texte court. Coût nul en argent.
 *   · **PUISSANT** — Qwen 3.5-122B chez Infomaniak, en Suisse. Lire une
 *     facture, une notice, un site : tout ce qui demande de comprendre.
 *   · **RECHERCHE** — Perplexity, aux États-Unis. **Le seul étage qui sorte
 *     du pays** : la limite « sujets publics » se tient dans cette table de
 *     routage, pas dans la bonne volonté des appelants.
 *
 * Deux pièges déjà payés ailleurs, tenus ici :
 *   · **on débite le coût, pas les jetons** — sinon le même quota vaut dix
 *     fois plus selon le modèle ;
 *   · **la devise n'est jamais implicite** — Infomaniak facture en francs,
 *     Perplexity en dollars **plus un forfait par requête** qui pèse, sur une
 *     recherche courte, davantage que les jetons.
 */

export type Etage = 'LOCAL' | 'PUISSANT' | 'RECHERCHE';
export type Devise = 'CHF' | 'USD';

export interface Tarif {
  /** Par million de jetons. */
  entree: number;
  sortie: number;
  /** Facturé à chaque requête, quel que soit le nombre de jetons. */
  forfait?: number;
  devise: Devise;
  etage: Etage;
  fournisseur: string;
}

/** Identifiants et tarifs relevés le 18.09.2026 (Infomaniak) et le 24.09.2026 (Perplexity). */
export const TARIFS: Record<string, Tarif> = {
  'Qwen/Qwen3.5-122B-A10B-FP8': {
    entree: 0.4,
    sortie: 3.2,
    devise: 'CHF',
    etage: 'PUISSANT',
    fournisseur: 'infomaniak',
  },
  'Qwen/Qwen3.5-397B-A17B-FP8': {
    entree: 0.8,
    sortie: 3.6,
    devise: 'CHF',
    etage: 'PUISSANT',
    fournisseur: 'infomaniak',
  },
  'mistralai/Mistral-Small-4-119B-2603': {
    entree: 0.2,
    sortie: 0.75,
    devise: 'CHF',
    etage: 'PUISSANT',
    fournisseur: 'infomaniak',
  },
  'swiss-ai/Apertus-v1.5-70B': {
    entree: 0.7,
    sortie: 2.5,
    devise: 'CHF',
    etage: 'PUISSANT',
    fournisseur: 'infomaniak',
  },
  // Notre serveur : la mémoire est déjà payée, l'appel ne coûte rien de plus.
  'qwen3.5:4b': { entree: 0, sortie: 0, devise: 'CHF', etage: 'LOCAL', fournisseur: 'ollama' },
  sonar: {
    entree: 1,
    sortie: 1,
    forfait: 0.005,
    devise: 'USD',
    etage: 'RECHERCHE',
    fournisseur: 'perplexity',
  },
  'sonar-pro': {
    entree: 3,
    sortie: 15,
    forfait: 0.006,
    devise: 'USD',
    etage: 'RECHERCHE',
    fournisseur: 'perplexity',
  },
};

/**
 * Quel étage pour quelle opération. **L'appelant ne choisit pas** : ajouter
 * une ligne `RECHERCHE` ici, c'est décider que ce sujet peut sortir de Suisse.
 */
export const ROUTAGE: Record<string, Etage> = {
  'factures.lecture': 'PUISSANT',
  'passeport.equipements': 'PUISSANT',
  'soumissions.offre': 'PUISSANT',
  'acteurs.site-web': 'PUISSANT',
  'recherche.web': 'RECHERCHE',
  // Trier un e-mail entrant, deviner un corps de métier : le petit modèle
  // suffit, et rien ne quitte le serveur.
  'emails.tri': 'LOCAL',
};

export function etagePour(usage: string): Etage {
  return ROUTAGE[usage] ?? 'PUISSANT';
}

/**
 * Valeur d'un crédit, au 22.09.2026 : 500 crédits ≈ CHF 0.25 de facture.
 * C'est notre coût plafond, pas le prix payé par le client.
 */
export const CHF_PAR_CREDIT = 0.0005;

/** Taux retenu le 28.09.2026 pour ramener un coût en dollars à des francs. */
export const USD_EN_CHF = 0.8;

export interface Cout {
  montant: number;
  devise: Devise;
  etage: Etage;
  fournisseur: string;
}

/**
 * Le coût d'un appel, dans la devise du fournisseur. `null` pour un modèle
 * absent de la table : mieux vaut un coût inconnu, visible, qu'un coût faux
 * emprunté au voisin — c'est ainsi qu'on sous-facture sans le voir.
 */
export function coutAppel(
  modele: string,
  tokensEntree: number,
  tokensSortie: number,
  requetes = 1,
): Cout | null {
  const tarif = TARIFS[modele];
  if (!tarif) return null;
  const jetons = (tokensEntree * tarif.entree + tokensSortie * tarif.sortie) / 1_000_000;
  const forfait = (tarif.forfait ?? 0) * requetes;
  return {
    // Six décimales : un appel court chez Perplexity vaut 0.005 dollar, et
    // arrondir au centime l'effacerait.
    montant: Number((jetons + forfait).toFixed(6)),
    devise: tarif.devise,
    etage: tarif.etage,
    fournisseur: tarif.fournisseur,
  };
}

export function enFrancs(montant: number, devise: Devise): number {
  return devise === 'USD' ? montant * USD_EN_CHF : montant;
}

/**
 * Du coût aux crédits : arrondi supérieur, **au moins un crédit** dès qu'un
 * appel coûte quelque chose — sinon une rafale d'appels courts serait
 * gratuite. Un appel local ne coûte rien, donc zéro crédit : il est
 * journalisé quand même, c'est lui qui dira s'il faut un plus gros serveur.
 */
export function coutEnCredits(cout: Cout | null): number {
  if (!cout || cout.montant <= 0) return 0;
  return Math.max(1, Math.ceil(enFrancs(cout.montant, cout.devise) / CHF_PAR_CREDIT));
}
