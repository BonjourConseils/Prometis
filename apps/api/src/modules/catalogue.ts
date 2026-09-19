import type { AppModule, SocieteProfil, StatutSouscription } from '@prisma/client';

/**
 * Ce que Prometis vend, et ce que chaque offre ouvre.
 *
 * **Deux niveaux, et il ne faut pas les confondre.** Les dix-huit modules
 * techniques (`AppModule`) sont des interrupteurs de routes : ils servent au
 * contrôle fin, et restent tels quels. Personne n'achète dix-huit
 * interrupteurs. Ce qui se vend, ce sont les **modules commerciaux** ci-dessous,
 * chacun un ensemble de modules techniques.
 *
 * La correspondance vit ici, dans le code — versionnée, relue, testée — et non
 * en base, où elle dériverait sans laisser de trace.
 */

/**
 * Le socle : ce que toute société a, quoi qu'elle achète.
 *
 * **Le budget CFC n'est pas un module, c'est le socle.** Une facture s'impute
 * sur un poste CFC ; un appel d'offres se lance depuis un poste CFC. Vendre le
 * contrôle des factures sans le CFC, c'est vendre des factures qui n'ont nulle
 * part où aller. Et le fil rouge — budgété, adjugé, commandé, facturé, payé —
 * est la valeur du produit : l'avoir partout rend chaque module meilleur.
 */
export const SOCLE: readonly AppModule[] = [
  'FONCIER',
  'BUDGET_CFC',
  'ECARTS',
  'SUIVI_CHANTIER',
  'ACTEURS',
  'GED',
  'SEANCES',
];

export type CodeModule = 'APPELS_DE_FONDS' | 'CONTROLE_FACTURES' | 'APPELS_OFFRES' | 'PASSEPORT';

export interface ModuleCommercial {
  code: CodeModule;
  libelle: string;
  /** Une phrase : ce que le module fait pour le client. */
  promesse: string;
  techniques: readonly AppModule[];
  /** Profils de société qui peuvent le souscrire. */
  profils: readonly SocieteProfil[];
  /**
   * Ce que le module perd s'il est pris seul — dit à la vente, plutôt que
   * découvert à l'usage.
   */
  seul?: string;
}

const TOUS: readonly SocieteProfil[] = [
  'PROMOTEUR',
  'ENTREPRISE_GENERALE',
  'ARCHITECTE',
  'BUREAU_TECHNIQUE',
  'REGIE',
];

export const CATALOGUE: readonly ModuleCommercial[] = [
  {
    code: 'APPELS_DE_FONDS',
    libelle: 'Appels de fonds',
    promesse:
      'Les lots et les acquéreurs viennent de Kolabimo ; Prometis calcule, envoie et suit chaque appel — lettre, bordereau QR, encaissements.',
    techniques: [
      'LOTS',
      'ACQUEREURS',
      'BILAN_PROMOTEUR',
      'ECHEANCIER',
      'APPELS_FONDS',
      'TRESORERIE',
      'COURTAGE',
    ],
    // Une entreprise générale ne vend pas de lots : elle ne doit jamais voir
    // la commercialisation, même en « simulation » (CLAUDE.md §2).
    profils: ['PROMOTEUR'],
  },
  {
    code: 'CONTROLE_FACTURES',
    libelle: 'Contrôle des factures',
    promesse:
      'Chaque facture lue, imputée au bon poste CFC et comparée au contrat — un dépassement se voit avant d’être payé.',
    techniques: ['FACTURES', 'CONTRATS'],
    profils: TOUS,
    seul: 'Sans les appels d’offres, les contrats se saisissent à la main : le rapprochement automatique facture ↔ contrat en dépend.',
  },
  {
    code: 'APPELS_OFFRES',
    libelle: 'Appels d’offres',
    promesse:
      'Dossier envoyé aux entreprises, questions et dépôt des offres en ligne sous pli scellé, notation multicritère, adjudication tracée, contrat SIA 118.',
    techniques: ['SOUMISSIONS', 'ADJUDICATIONS', 'CONTRATS'],
    profils: TOUS,
    seul: 'Sans le contrôle des factures, le montant commandé ne se confronte à rien.',
  },
  {
    code: 'PASSEPORT',
    libelle: 'Passeport numérique',
    promesse:
      'Le dossier de l’ouvrage livré : plans, équipements, garanties et leurs échéances — ce qui sert encore dix ans après la remise des clés.',
    techniques: ['PASSEPORT'],
    profils: TOUS,
  },
];

export function moduleCommercial(code: string): ModuleCommercial | undefined {
  return CATALOGUE.find((m) => m.code === code);
}

export interface Souscription {
  module: string;
  statut: StatutSouscription;
  finEssai?: Date | null;
  /** Résiliation programmée : payé jusqu'à cette date, lecture seule ensuite. */
  finAcces?: Date | null;
}

/**
 * Les modules techniques qu'ouvrent des souscriptions — **la** règle.
 *
 * - le socle, toujours ;
 * - un module ACTIF, ou en ESSAI non échu, ouvre ses modules techniques ;
 * - un module RÉSILIÉ — ou un essai échu — les met en **lecture seule** : les
 *   données restent consultables, plus rien ne s'y écrit. Résilier ne détruit
 *   rien ;
 * - un module technique partagé (CONTRATS) reste ouvert tant qu'un seul des
 *   modules qui le contiennent l'est — la lecture seule ne l'emporte jamais
 *   sur une ouverture.
 *
 * Un profil qui n'a pas droit au module n'en reçoit rien, même souscrit :
 * c'est la dernière ligne de défense si une souscription était mal posée.
 */
export function modulesTechniques(
  souscriptions: readonly Souscription[],
  profil: SocieteProfil,
  maintenant: Date = new Date(),
): { actifs: AppModule[]; lecture: AppModule[] } {
  const actifs = new Set<AppModule>(SOCLE);
  const lecture = new Set<AppModule>();

  for (const s of souscriptions) {
    const module = moduleCommercial(s.module);
    if (!module || !module.profils.includes(profil)) continue;

    const essaiEchu = s.statut === 'ESSAI' && s.finEssai != null && s.finEssai <= maintenant;
    // Une résiliation programmée garde le module ouvert jusqu'au bout de la
    // période payée — on ne retire jamais ce qui a été réglé.
    const accesEchu = s.finAcces != null && s.finAcces <= maintenant;
    const ouvert = !accesEchu && (s.statut === 'ACTIF' || (s.statut === 'ESSAI' && !essaiEchu));
    for (const t of module.techniques) (ouvert ? actifs : lecture).add(t);
  }

  for (const t of actifs) lecture.delete(t);
  return { actifs: [...actifs].sort(), lecture: [...lecture].sort() };
}
