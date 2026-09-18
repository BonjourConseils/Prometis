/**
 * Facturation par module — les règles pures (skill plans-payants).
 */
import { describe, expect, it } from 'vitest';
import {
  abonnementVivant,
  apercuValide,
  essaiAEcrire,
  essaiPermis,
  francs,
  lireAbonnement,
  statutModule,
  tarifVendable,
} from '../apps/api/src/facturation/regles';
import { modulesTechniques } from '../apps/api/src/modules/catalogue';

const tarifs = [
  { module: 'PASSEPORT', prixMensuel: '49.00', stripePriceId: 'price_passeport' },
  { module: 'CONTROLE_FACTURES', prixMensuel: '89.00', stripePriceId: 'price_factures' },
];

describe('un module ne se vend qu’avec un prix complet', () => {
  it('prix et identifiant Stripe : vendable', () => {
    expect(tarifVendable(tarifs[0])).toBe(true);
  });
  it('sans identifiant Stripe, sans prix, ou à zéro : invisible — jamais « Gratuit »', () => {
    expect(tarifVendable({ module: 'X', prixMensuel: '49', stripePriceId: null })).toBe(false);
    expect(tarifVendable({ module: 'X', prixMensuel: '49', stripePriceId: '  ' })).toBe(false);
    expect(tarifVendable({ module: 'X', prixMensuel: '0', stripePriceId: 'price_x' })).toBe(false);
    expect(tarifVendable(undefined)).toBe(false);
  });
});

describe('abonnement et essai', () => {
  it('un abonnement vivant interdit un second Checkout', () => {
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'incomplete']) {
      expect(abonnementVivant(s)).toBe(true);
    }
    for (const s of ['canceled', 'incomplete_expired', null, undefined]) {
      expect(abonnementVivant(s)).toBe(false);
    }
  });

  it('un seul essai par société, même après résiliation', () => {
    expect(essaiPermis(null)).toBe(true);
    expect(essaiPermis({ essaiFinLe: null })).toBe(true);
    expect(essaiPermis({ essaiFinLe: new Date('2026-01-01') })).toBe(false);
  });

  it('la date d’essai suit Stripe, mais n’est jamais effacée', () => {
    const base = new Date('2026-09-25');
    const stripe = new Date('2026-09-28');
    expect(essaiAEcrire(stripe, base)).toEqual(stripe); // prolongé côté Stripe
    expect(essaiAEcrire(null, base)).toEqual(base); // converti : trial_end nul
    expect(essaiAEcrire(null, null)).toBeNull();
  });
});

describe('statut Stripe → statut du module', () => {
  it('essai, actif, impayé (accès conservé), résilié', () => {
    expect(statutModule('trialing')).toBe('ESSAI');
    expect(statutModule('active')).toBe('ACTIF');
    expect(statutModule('past_due')).toBe('ACTIF');
    expect(statutModule('canceled')).toBe('RESILIE');
    expect(statutModule('incomplete_expired')).toBe('RESILIE');
  });
});

describe('lire un abonnement Stripe en modules', () => {
  const abonnement = {
    id: 'sub_1',
    status: 'trialing',
    trial_end: 1_790_000_000,
    cancel_at_period_end: false,
    items: {
      data: [
        { id: 'si_a', price: { id: 'price_passeport' }, current_period_end: 1_790_500_000 },
        { id: 'si_b', price: { id: 'price_factures' }, current_period_end: 1_790_400_000 },
        { id: 'si_c', price: { id: 'price_inconnu' }, current_period_end: 1_790_600_000 },
      ],
    },
  };

  it('le prix identifie le module ; la fin de période vient des éléments', () => {
    const etat = lireAbonnement(abonnement, tarifs);
    expect(etat.modules).toEqual([
      { module: 'PASSEPORT', itemId: 'si_a' },
      { module: 'CONTROLE_FACTURES', itemId: 'si_b' },
    ]);
    expect(etat.finPeriode).toEqual(new Date(1_790_400_000 * 1000));
    expect(etat.essaiFinLe).toEqual(new Date(1_790_000_000 * 1000));
  });

  it('un prix sans module est signalé, pas ignoré en silence', () => {
    expect(lireAbonnement(abonnement, tarifs).inconnus).toEqual(['price_inconnu']);
  });
});

describe('un clic ne facture jamais', () => {
  it('l’aperçu périme après dix minutes', () => {
    const maintenant = Date.now();
    const s = Math.floor(maintenant / 1000);
    expect(apercuValide(s, maintenant)).toBe(true);
    expect(apercuValide(s - 9 * 60, maintenant)).toBe(true);
    expect(apercuValide(s - 11 * 60, maintenant)).toBe(false);
    expect(apercuValide(s + 3600, maintenant)).toBe(false);
  });

  it('les montants se lisent à la suisse', () => {
    expect(francs(4900)).toBe('CHF 49.00');
    expect(francs(123456)).toBe('CHF 1’234.56');
  });
});

describe('résiliation programmée', () => {
  const avant = new Date('2026-09-18T12:00:00Z');
  const apres = new Date('2026-10-20T12:00:00Z');
  const s = {
    module: 'PASSEPORT',
    statut: 'ACTIF' as const,
    finAcces: new Date('2026-10-18T00:00:00Z'),
  };

  it('le module reste ouvert jusqu’au bout de la période payée', () => {
    expect(modulesTechniques([s], 'PROMOTEUR', avant).actifs).toContain('PASSEPORT');
  });

  it('puis passe en lecture seule — rien n’est effacé', () => {
    const ouverts = modulesTechniques([s], 'PROMOTEUR', apres);
    expect(ouverts.actifs).not.toContain('PASSEPORT');
    expect(ouverts.lecture).toContain('PASSEPORT');
  });
});
