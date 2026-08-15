/**
 * Lot 9 — le parcours complet du second facteur, contre l'API réelle.
 *
 * Ce que ce fichier doit prouver, et qui ne se voit pas en lisant le code :
 *
 *   · un enrôlement **non confirmé** n'enferme personne dehors ;
 *   · une fois actif, le mot de passe seul ne suffit plus ;
 *   · le jeton délivré entre les deux n'ouvre **rien** ;
 *   · un code de secours fonctionne une fois, et une seule.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, MOT_DE_PASSE, apiDisponible, appel } from './api-client';
import { ownerDb } from './tenant-db';
import { codeTotp } from '../apps/api/src/auth/totp';

const EMAIL = 'julie@cbpromotions.ch';

let jetonIdentite: string;
let secret = '';
let codesSecours: string[] = [];

interface ReponseLogin {
  mfaRequis: boolean;
  defiToken?: string;
  accessToken?: string;
}

async function connexion(): Promise<{ status: number; body: ReponseLogin }> {
  const res = await appel<ReponseLogin>('/auth/login', {
    methode: 'POST',
    corps: { email: EMAIL, motDePasse: MOT_DE_PASSE },
  });
  return { status: res.status, body: res.body };
}

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Lancer « npm run verifier ».`);
  }
  const premiere = await connexion();
  jetonIdentite = premiere.body.accessToken!;
});

afterAll(async () => {
  // Le compte du seed doit repartir sans second facteur, sinon la suite
  // suivante se connecterait à un compte qu'elle ne sait pas déverrouiller.
  await ownerDb.compte.update({
    where: { email: EMAIL },
    data: { totpSecret: null, totpActiveAt: null, codesSecours: [] },
  });
  await ownerDb.$disconnect();
});

describe('Enrôlement', () => {
  it('part d’un compte sans second facteur', async () => {
    const res = await appel<{ actif: boolean; enrolementEnCours: boolean }>('/auth/mfa', {
      token: jetonIdentite,
    });
    expect(res.body.actif).toBe(false);
    expect(res.body.enrolementEnCours).toBe(false);
  });

  it('produit un secret et une URI otpauth', async () => {
    const res = await appel<{ secret: string; uri: string }>('/auth/mfa/enrolement', {
      methode: 'POST',
      token: jetonIdentite,
    });
    expect(res.ok).toBe(true);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(res.body.uri).toContain('otpauth://totp/');
    secret = res.body.secret;
  });

  it('n’enferme personne dehors tant qu’il n’est pas confirmé', async () => {
    // Le cas réel : le QR code s'affiche, l'utilisateur ferme la fenêtre.
    // Sans cette distinction, il ne pourrait plus se connecter.
    const res = await connexion();
    expect(res.body.mfaRequis).toBe(false);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('refuse un code faux à l’activation', async () => {
    const res = await appel('/auth/mfa/activer', {
      methode: 'POST',
      token: jetonIdentite,
      corps: { code: '000000' },
    });
    expect(res.status).toBe(400);
  });

  it('s’active sur un code juste et rend dix codes de secours', async () => {
    const res = await appel<{ codesSecours: string[] }>('/auth/mfa/activer', {
      methode: 'POST',
      token: jetonIdentite,
      corps: { code: codeTotp(secret) },
    });
    expect(res.ok).toBe(true);
    expect(res.body.codesSecours).toHaveLength(10);
    codesSecours = res.body.codesSecours;
  });

  it('ne stocke jamais le secret en clair', async () => {
    const compte = await ownerDb.compte.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { totpSecret: true, codesSecours: true },
    });
    expect(compte.totpSecret).not.toContain(secret);
    expect(compte.totpSecret!.startsWith('v1.')).toBe(true);
    // Les codes de secours non plus : seules leurs empreintes sont gardées.
    for (const code of codesSecours) {
      expect(compte.codesSecours.join(' ')).not.toContain(code.replace('-', ''));
    }
  });
});

describe('Connexion avec second facteur', () => {
  it('le mot de passe seul ne suffit plus', async () => {
    const res = await connexion();
    expect(res.body.mfaRequis).toBe(true);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.defiToken).toBeTruthy();
  });

  it('le jeton de défi n’ouvre aucune route', async () => {
    // C'est le point qui empêche de contourner le second facteur : le jeton
    // rendu après le mot de passe ne vaut pas jeton d'identité.
    const { body } = await connexion();
    const res = await appel('/auth/workspaces', { token: body.defiToken });
    expect(res.status).toBe(401);
  });

  it('refuse un code faux', async () => {
    const { body } = await connexion();
    const res = await appel('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: body.defiToken, code: '000000' },
    });
    expect(res.status).toBe(401);
  });

  it('ouvre la session sur un code juste', async () => {
    const { body } = await connexion();
    const res = await appel<{ accessToken: string; workspaces: unknown[] }>('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: body.defiToken, code: codeTotp(secret) },
    });
    expect(res.ok).toBe(true);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.workspaces.length).toBeGreaterThan(0);

    // Et ce jeton-là, lui, fonctionne.
    const espaces = await appel('/auth/workspaces', { token: res.body.accessToken });
    expect(espaces.ok).toBe(true);
  });
});

describe('Codes de secours', () => {
  it('remplacent le code une fois, et une seule', async () => {
    const code = codesSecours[0]!;

    const premiere = await connexion();
    const acceptee = await appel<{ accessToken: string }>('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: premiere.body.defiToken, code },
    });
    expect(acceptee.ok).toBe(true);

    // Rejoué, le même code doit être refusé : c'est le retrait de la liste
    // qui fait l'usage unique.
    const seconde = await connexion();
    const refusee = await appel('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: seconde.body.defiToken, code },
    });
    expect(refusee.status).toBe(401);
  });

  it('se décomptent', async () => {
    const { body } = await connexion();
    const session = await appel<{ accessToken: string }>('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: body.defiToken, code: codeTotp(secret) },
    });
    const etat = await appel<{ codesSecoursRestants: number }>('/auth/mfa', {
      token: session.body.accessToken,
    });
    expect(etat.body.codesSecoursRestants).toBe(9);
  });
});

describe('Désactivation', () => {
  it('exige un code valide, pas seulement la session', async () => {
    const { body } = await connexion();
    const session = await appel<{ accessToken: string }>('/auth/mfa/verifier', {
      methode: 'POST',
      corps: { defiToken: body.defiToken, code: codeTotp(secret) },
    });

    // Une session volée ne doit pas pouvoir retirer la protection qu'elle
    // vient de contourner.
    const refus = await appel('/auth/mfa', {
      methode: 'DELETE',
      token: session.body.accessToken,
      corps: { code: '000000' },
    });
    expect(refus.status).toBe(400);

    const res = await appel('/auth/mfa', {
      methode: 'DELETE',
      token: session.body.accessToken,
      corps: { code: codeTotp(secret) },
    });
    expect(res.ok).toBe(true);

    const apres = await connexion();
    expect(apres.body.mfaRequis).toBe(false);
  });
});
