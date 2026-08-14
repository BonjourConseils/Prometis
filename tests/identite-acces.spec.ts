/**
 * Lot 1 — Definition of Done :
 *   « un compte Probat bascule entre deux sociétés isolées ;
 *     une EG a un accès scopé par module. »
 *
 * Tests de bout en bout sur l'API HTTP réelle, adossée à la vraie base.
 * Prérequis : l'API doit tourner (`npm run dev:api`) et la base être seedée.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  COMPTES,
  CONSTRUCTA,
  PROBAT,
  apiDisponible,
  appel,
  connexion,
  jetonPourEspace,
} from './api-client';

beforeAll(async () => {
  if (!(await apiDisponible())) {
    // On échoue bruyamment plutôt que d'ignorer : une suite « verte » qui a
    // silencieusement sauté la moitié des vérifications est pire qu'un échec.
    throw new Error(
      `API injoignable sur ${API}. Démarrer « npm run dev:api » (ou « node apps/api/dist/main.js ») ` +
        'puis relancer. La base doit être migrée et seedée.',
    );
  }
});

// =====================================================================

describe('authentification', () => {
  it('refuse un mot de passe faux', async () => {
    const res = await appel('/auth/login', {
      methode: 'POST',
      corps: { email: COMPTES.christophe, motDePasse: 'pas-le-bon' },
    });
    expect(res.status).toBe(401);
  });

  it('ne distingue pas un compte inconnu d’un mot de passe faux', async () => {
    const inconnu = await appel<{ message: string }>('/auth/login', {
      methode: 'POST',
      corps: { email: 'personne@nulle-part.ch', motDePasse: 'peu importe' },
    });
    const mauvais = await appel<{ message: string }>('/auth/login', {
      methode: 'POST',
      corps: { email: COMPTES.christophe, motDePasse: 'pas-le-bon' },
    });

    expect(inconnu.status).toBe(mauvais.status);
    expect(inconnu.body.message).toBe(mauvais.body.message);
  });

  it('rejette un corps de requête invalide', async () => {
    const res = await appel('/auth/login', { methode: 'POST', corps: { email: 'pas-un-email' } });
    expect(res.status).toBe(400);
  });

  it('refuse toute route métier sans jeton', async () => {
    expect((await appel('/operations')).status).toBe(401);
    expect((await appel('/societe')).status).toBe(401);
    expect((await appel('/acces/membres')).status).toBe(401);
  });

  it('refuse un jeton fabriqué', async () => {
    const res = await appel('/operations', { token: 'ceci.nest.pas.un.jeton' });
    expect(res.status).toBe(401);
  });
});

// =====================================================================

describe("le jeton d'identité seul n'ouvre aucune donnée métier", () => {
  it('donne accès au sélecteur d’espace, et à rien d’autre', async () => {
    const { accessToken } = await connexion(COMPTES.marc);

    const workspaces = await appel('/auth/workspaces', { token: accessToken });
    expect(workspaces.status).toBe(200);

    // Aucun `app.societe_id` ne peut être posé : la requête est refusée en amont.
    expect((await appel('/operations', { token: accessToken })).status).toBe(403);
    expect((await appel('/societe', { token: accessToken })).status).toBe(403);
  });
});

// =====================================================================

describe('DoD — un compte bascule entre deux sociétés isolées', () => {
  it('Marc est membre de deux sociétés', async () => {
    const { workspaces } = await connexion(COMPTES.marc);
    expect(workspaces.map((w) => w.societeId).sort()).toEqual([PROBAT, CONSTRUCTA].sort());

    const probat = workspaces.find((w) => w.societeId === PROBAT);
    const constructa = workspaces.find((w) => w.societeId === CONSTRUCTA);
    expect(probat?.role).toBe('EXTERNE');
    expect(constructa?.role).toBe('OWNER');
  });

  it('chaque espace ne montre que sa propre société', async () => {
    const chezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const chezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

    const s1 = await appel<{ raisonSociale: string; profil: string }>('/societe', {
      token: chezProbat,
    });
    const s2 = await appel<{ raisonSociale: string; profil: string }>('/societe', {
      token: chezConstructa,
    });

    expect(s1.body.raisonSociale).toBe('Probat Promotions SA');
    expect(s1.body.profil).toBe('PROMOTEUR');
    expect(s2.body.raisonSociale).toBe('Constructa Entreprise Générale SA');
    expect(s2.body.profil).toBe('ENTREPRISE_GENERALE');
  });

  it('les opérations ne se mélangent pas entre les deux espaces', async () => {
    const chezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const chezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

    const o1 = await appel<{ id: number; nom: string }[]>('/operations', { token: chezProbat });
    const o2 = await appel<{ id: number; nom: string }[]>('/operations', { token: chezConstructa });

    expect(o1.body.map((o) => o.nom)).toEqual(['Les Jardins de Prilly']);
    expect(o2.body.map((o) => o.nom)).toEqual(['Résidence du Lac']);
  });

  it("le jeton d'un espace n'atteint pas l'opération de l'autre", async () => {
    const chezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);
    const chezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);

    const idProbat = (await appel<{ id: number }[]>('/operations', { token: chezProbat })).body[0]!
      .id;

    const vol = await appel(`/operations/${idProbat}`, { token: chezConstructa });
    expect(vol.status).toBe(404);
  });

  it("refuse une société dont le compte n'est pas membre", async () => {
    const { accessToken } = await connexion(COMPTES.christophe);
    const res = await appel('/auth/workspace', {
      methode: 'POST',
      token: accessToken,
      corps: { societeId: CONSTRUCTA },
    });
    expect(res.status).toBe(403);
  });

  it('refuse une société inexistante avec le même message', async () => {
    const { accessToken } = await connexion(COMPTES.christophe);
    const inexistante = await appel<{ message: string }>('/auth/workspace', {
      methode: 'POST',
      token: accessToken,
      corps: { societeId: 99_999 },
    });
    const nonMembre = await appel<{ message: string }>('/auth/workspace', {
      methode: 'POST',
      token: accessToken,
      corps: { societeId: CONSTRUCTA },
    });

    // Sinon la différence de réponse révélerait quelles sociétés existent.
    expect(inexistante.body.message).toBe(nonMembre.body.message);
  });
});

// =====================================================================

describe('rôles au niveau du tenant', () => {
  it('un EXTERNE ne gère pas les droits de la société', async () => {
    const token = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel<{ message: string }>('/acces/membres', { token });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('OWNER, ADMIN');
  });

  it('un CHEF_PROJET non plus', async () => {
    const token = await jetonPourEspace(COMPTES.julie, PROBAT);
    expect((await appel('/acces/membres', { token })).status).toBe(403);
  });

  it('un OWNER, oui — et il voit internes et externes', async () => {
    const token = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const res = await appel<{ estExterne: boolean; compte: { email: string } }[]>(
      '/acces/membres',
      {
        token,
      },
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.filter((m) => m.estExterne).map((m) => m.compte.email)).toEqual([COMPTES.marc]);
  });

  it('le même compte change de droits selon la société', async () => {
    // Marc est EXTERNE chez Probat et OWNER chez Constructa : c'est le même
    // identifiant, et pourtant deux niveaux d'autorité distincts.
    const chezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const chezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

    expect((await appel('/acces/membres', { token: chezProbat })).status).toBe(403);
    expect((await appel('/acces/membres', { token: chezConstructa })).status).toBe(200);
  });

  it('la piste d’audit est réservée à la direction', async () => {
    const julie = await jetonPourEspace(COMPTES.julie, PROBAT);
    const christophe = await jetonPourEspace(COMPTES.christophe, PROBAT);

    expect((await appel('/audit-logs', { token: julie })).status).toBe(403);
    expect((await appel('/audit-logs', { token: christophe })).status).toBe(200);
  });
});

// =====================================================================

describe('droits par opération (OperationAccess)', () => {
  it('un administrateur voit toutes les opérations sans droit ligne à ligne', async () => {
    const token = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const droits = await appel<{ estAdministrateur: boolean; operations: unknown[] }>(
      '/acces/mes-droits',
      { token },
    );

    expect(droits.body.estAdministrateur).toBe(true);
    expect(droits.body.operations).toHaveLength(1);
  });

  it('un non-administrateur ne voit que les opérations qui lui sont confiées', async () => {
    const token = await jetonPourEspace(COMPTES.julie, PROBAT);
    const droits = await appel<{
      estAdministrateur: boolean;
      operations: { nom: string; accessLevel: string }[];
    }>('/acces/mes-droits', { token });

    expect(droits.body.estAdministrateur).toBe(false);
    expect(droits.body.operations).toEqual([
      expect.objectContaining({ nom: 'Les Jardins de Prilly', accessLevel: 'MANAGE' }),
    ]);
  });

  it('OPERATE suffit pour lire, pas pour gérer les droits', async () => {
    const marc = await jetonPourEspace(COMPTES.marc, PROBAT);
    const operationId = (await appel<{ id: number }[]>('/operations', { token: marc })).body[0]!.id;

    // OPERATE ≥ READ_ONLY
    expect((await appel(`/operations/${operationId}`, { token: marc })).status).toBe(200);
    // …mais MANAGE est requis pour toucher aux droits.
    const gestion = await appel<{ message: string }>(`/acces/operations/${operationId}`, {
      token: marc,
    });
    expect(gestion.status).toBe(403);
    expect(gestion.body.message).toContain('MANAGE');
  });

  it('MANAGE permet de consulter les droits de l’opération', async () => {
    const julie = await jetonPourEspace(COMPTES.julie, PROBAT);
    const operationId = (await appel<{ id: number }[]>('/operations', { token: julie })).body[0]!
      .id;
    expect((await appel(`/acces/operations/${operationId}`, { token: julie })).status).toBe(200);
  });

  it('une opération sans droit répond « introuvable », pas « interdit »', async () => {
    // Révéler l'existence d'une opération à qui n'y a pas droit est déjà
    // une fuite d'information.
    const constructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);
    const probat = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const idProbat = (await appel<{ id: number }[]>('/operations', { token: probat })).body[0]!.id;

    const res = await appel(`/operations/${idProbat}`, { token: constructa });
    expect(res.status).toBe(404);
  });
});

// =====================================================================

describe('DoD — une EG a un accès scopé par module', () => {
  it("l'accès de l'EG est restreint à trois modules", async () => {
    const token = await jetonPourEspace(COMPTES.marc, PROBAT);
    const droits = await appel<{ operations: { modules: string[] }[] }>('/acces/mes-droits', {
      token,
    });

    expect(droits.body.operations[0]!.modules.sort()).toEqual([
      'CONTRATS',
      'DOCUMENTS',
      'SOUMISSIONS',
    ]);
  });

  it("un module hors périmètre est refusé, même avec le bon niveau d'accès", async () => {
    const marc = await jetonPourEspace(COMPTES.marc, PROBAT);
    const operationId = (await appel<{ id: number }[]>('/operations', { token: marc })).body[0]!.id;

    // ACTEURS n'est pas dans [SOUMISSIONS, CONTRATS, DOCUMENTS] : refus, alors
    // même que Marc a OPERATE sur cette opération.
    const res = await appel<{ message: string }>(`/operations/${operationId}/acteurs`, {
      token: marc,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('ACTEURS');
  });

  it('un administrateur, lui, y accède', async () => {
    const christophe = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const operationId = (await appel<{ id: number }[]>('/operations', { token: christophe }))
      .body[0]!.id;

    const res = await appel<unknown[]>(`/operations/${operationId}/acteurs`, { token: christophe });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('une restriction vide ne restreint rien', async () => {
    // Julie a MANAGE avec `modules: []` — aucune restriction fine.
    const julie = await jetonPourEspace(COMPTES.julie, PROBAT);
    const operationId = (await appel<{ id: number }[]>('/operations', { token: julie })).body[0]!
      .id;
    expect((await appel(`/operations/${operationId}/acteurs`, { token: julie })).status).toBe(200);
  });

  it('les modules de la société bornent ce qui existe', async () => {
    const constructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);
    const droits = await appel<{ modulesActifs: string[] }>('/acces/mes-droits', {
      token: constructa,
    });

    // Une entreprise générale n'a aucune surcouche commercialisation.
    for (const module of ['LOTS', 'ACQUEREURS', 'APPELS_FONDS', 'ECHEANCIER', 'BILAN_PROMOTEUR']) {
      expect(droits.body.modulesActifs).not.toContain(module);
    }
    expect(droits.body.modulesActifs).toContain('BUDGET_CFC');
  });
});

// =====================================================================

describe('garde-fous sur la gestion des membres', () => {
  it('on ne modifie pas son propre accès', async () => {
    const token = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const me = await appel<{ membership: { id: number } }>('/auth/me', { token });

    const res = await appel<{ message: string }>(`/acces/membres/${me.body.membership.id}`, {
      methode: 'PATCH',
      token,
      corps: { role: 'LECTURE_SEULE' },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('votre propre accès');
  });

  it('un corps vide est rejeté', async () => {
    const token = await jetonPourEspace(COMPTES.christophe, PROBAT);
    const res = await appel('/acces/membres/2', { methode: 'PATCH', token, corps: {} });
    expect(res.status).toBe(400);
  });
});
