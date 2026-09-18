/**
 * Facturation — les barrières de l'API, sans Stripe.
 *
 * En développement la souscription est fermée par défaut : ce qu'on vérifie
 * ici, c'est que les portes refusent — pas le parcours de paiement, qui se
 * teste contre le mode test de Stripe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb } from './tenant-db';

let christophe = '';
let julie = '';

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  julie = await jetonPourEspace(COMPTES.julie, CB);
});

afterAll(async () => {
  await ownerDb.$disconnect();
});

describe('la page des modules', () => {
  it('dit que la souscription est fermée, et ne propose rien sans prix', async () => {
    const res = await appel<{ ouverte: boolean; modules: { vendable: boolean }[] }>(
      '/facturation',
      { token: christophe },
    );
    expect(res.status).toBe(200);
    expect(res.body.ouverte).toBe(false);
    const tarifs = await ownerDb.tarifModule.count();
    if (tarifs === 0) expect(res.body.modules.every((m) => !m.vendable)).toBe(true);
  });

  it('est réservée aux administrateurs de la société', async () => {
    const res = await appel('/facturation', { token: julie });
    expect(res.status).toBe(403);
  });
});

describe('fermée, elle refuse de facturer', () => {
  it('démarrer un abonnement : 503, avec un message qui ne parle pas de configuration', async () => {
    const res = await appel<{ message: string }>('/facturation/demarrer', {
      token: christophe,
      methode: 'POST',
      corps: { modules: ['PASSEPORT'] },
    });
    expect(res.status).toBe(503);
    expect(res.body.message).not.toMatch(/[A-Z]{3,}_[A-Z]+/);
  });

  it('ajouter un module sans aperçu : refusé', async () => {
    const res = await appel('/facturation/modules/PASSEPORT/ajouter', {
      token: christophe,
      methode: 'POST',
      corps: { prorationDate: Math.floor(Date.now() / 1000) },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('les portes sans session', () => {
  it('webhook Stripe sans signature : refusé', async () => {
    const res = await fetch(`${API}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'evt_faux', type: 'customer.subscription.updated' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ownerDb.evenementStripe.count({ where: { id: 'evt_faux' } })).toBe(0);
  });

  it('passe quotidienne sans secret : 401', async () => {
    const res = await fetch(`${API}/internal/facturation/passe-quotidienne`, { method: 'POST' });
    expect(res.status).toBe(401);
    const res2 = await fetch(`${API}/internal/facturation/passe-quotidienne`, {
      method: 'POST',
      headers: { 'x-passe-secret': 'devine' },
    });
    expect(res2.status).toBe(401);
  });

  it('les prix se saisissent par l’exploitant seul', async () => {
    const res = await appel('/exploitant/tarifs/PASSEPORT', {
      token: christophe,
      methode: 'PUT',
      corps: { prixMensuel: '1', stripePriceId: null },
    });
    expect(res.status).toBe(403);
  });
});
