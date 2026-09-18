import type { StatutSouscription } from '@prisma/client';
import { CATALOGUE, type CodeModule } from '../modules/catalogue';

/**
 * Les règles de la facturation par module — pures, sans Stripe ni base.
 *
 * Tout ce qui décide (un module se propose-t-il ? un essai est-il permis ?
 * que vaut un abonnement Stripe en modules ouverts ?) vit ici et se teste
 * sans réseau. Le service ne fait qu'appliquer.
 */

export const DUREE_ESSAI_JOURS = 7;
/** Un aperçu de prorata périme : passé ce délai, le montant affiché n'est plus sûr. */
export const VALIDITE_APERCU_MS = 10 * 60 * 1000;
/** L'avertissement de fin d'essai part trois jours avant le prélèvement. */
export const AVANCE_AVERTISSEMENT_MS = 3 * 24 * 60 * 60 * 1000;

export interface Tarif {
  module: string;
  prixMensuel: { toString(): string } | number | string;
  stripePriceId: string | null;
}

/**
 * Un module ne se propose que s'il a un prix ET un identifiant Stripe.
 * Sans l'un ou l'autre, il n'apparaît pas — jamais « Gratuit », jamais
 * « Paiement indisponible » sur une carte qu'on pourrait croire active.
 */
export function tarifVendable(t: Tarif | undefined): t is Tarif & { stripePriceId: string } {
  if (!t || !t.stripePriceId?.trim()) return false;
  return Number(t.prixMensuel.toString()) > 0;
}

/** Les statuts Stripe d'un abonnement qui facture encore — ou va facturer. */
const VIVANTS = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete']);

export function abonnementVivant(statut: string | null | undefined): boolean {
  return statut != null && VIVANTS.has(statut);
}

/**
 * Un seul essai par société. C'est la date conservée en base qui le refuse,
 * pas Stripe : elle survit à la résiliation.
 */
export function essaiPermis(abonnement: { essaiFinLe: Date | null } | null | undefined): boolean {
  return !abonnement?.essaiFinLe;
}

/**
 * Ce que vaut, pour un module, le statut d'un abonnement Stripe.
 *
 * `past_due` garde l'accès : une carte refusée un matin ne coupe pas un
 * promoteur au milieu d'un appel de fonds. La durée de grâce avant blocage
 * est une décision du gérant, pas du code.
 */
export function statutModule(statutStripe: string): StatutSouscription {
  if (statutStripe === 'trialing') return 'ESSAI';
  if (statutStripe === 'active' || statutStripe === 'past_due' || statutStripe === 'unpaid') {
    return 'ACTIF';
  }
  return 'RESILIE';
}

/** La forme minimale d'un abonnement Stripe dont la synchronisation a besoin. */
export interface AbonnementStripe {
  id: string;
  status: string;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  items: {
    data: { id: string; price: { id: string }; current_period_end: number }[];
  };
}

export interface EtatSynchronise {
  statut: string;
  essaiFinLe: Date | null;
  /** La fin de période la plus proche : depuis 2025, elle vit sur chaque élément. */
  finPeriode: Date | null;
  annulationFinPeriode: boolean;
  modules: { module: CodeModule; itemId: string }[];
  /** Éléments dont le prix ne correspond à aucun module : à signaler, jamais ignorés en silence. */
  inconnus: string[];
}

const date = (secondes: number | null | undefined) =>
  secondes == null ? null : new Date(secondes * 1000);

/**
 * Lit un abonnement Stripe en termes de modules Prometis.
 *
 * Le prix identifie le module — c'est la même table qui a servi à créer
 * l'élément. Un prix inconnu est rendu à part : un élément facturé qui
 * n'ouvre rien est un défaut à voir, pas à taire.
 */
export function lireAbonnement(
  abonnement: AbonnementStripe,
  tarifs: readonly Tarif[],
): EtatSynchronise {
  const parPrix = new Map(
    tarifs.filter((t) => t.stripePriceId).map((t) => [t.stripePriceId!, t.module]),
  );
  const modules: EtatSynchronise['modules'] = [];
  const inconnus: string[] = [];
  for (const item of abonnement.items.data) {
    const code = parPrix.get(item.price.id);
    const module = CATALOGUE.find((m) => m.code === code);
    if (module) modules.push({ module: module.code, itemId: item.id });
    else inconnus.push(item.price.id);
  }
  const fins = abonnement.items.data.map((i) => i.current_period_end).filter(Boolean);
  return {
    statut: abonnement.status,
    essaiFinLe: date(abonnement.trial_end),
    finPeriode: fins.length ? date(Math.min(...fins)) : null,
    annulationFinPeriode: abonnement.cancel_at_period_end,
    modules,
    inconnus,
  };
}

/**
 * La date d'essai à écrire en base.
 *
 * « Si Stripe annonce une date, on l'écrit » — un essai raccourci ou prolongé
 * côté Stripe doit déplacer l'avertissement J-3. Mais jamais `null` : Stripe
 * efface `trial_end` une fois l'essai converti, et recopier ce vide
 * supprimerait la trace qui refuse un second essai.
 */
export function essaiAEcrire(stripe: Date | null, base: Date | null): Date | null {
  return stripe ?? base;
}

/** Un aperçu de prorata encore utilisable ? */
export function apercuValide(prorationDate: number, maintenant: number = Date.now()): boolean {
  const age = maintenant - prorationDate * 1000;
  return age >= -60_000 && age <= VALIDITE_APERCU_MS;
}

/** « 1 234.50 » — montant suisse, apostrophe typographique pour les milliers. */
export function francs(centimes: number): string {
  const [entier, dec] = (Math.abs(centimes) / 100).toFixed(2).split('.');
  const groupe = entier!.replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${centimes < 0 ? '-' : ''}CHF ${groupe}.${dec}`;
}

/** « 18.09.2026 » */
export function dateSuisse(d: Date): string {
  return d.toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Zurich',
  });
}
