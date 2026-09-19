/**
 * Équipe — inviter un employé, un architecte, une direction des travaux.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { API, COMPTES, CB, apiDisponible, appel, connexion, jetonPourEspace } from './api-client';
import { ownerDb } from './tenant-db';

const DT = 'test-invitation-dt@exemple.ch';
const EXISTANT = 'test-invitation-existant@exemple.ch';
const MDP = 'Un-mot-de-passe-solide-2026';
let christophe = '';
let julie = '';
let operationId = 0;
let autreOperation = 0;

const empreinte = (j: string) => createHash('sha256').update(j).digest('hex');

/** Le lien envoyé est inconnu : on en pose un connu, en empreinte. */
async function poserJeton(email: string): Promise<string> {
  const jeton = randomBytes(32).toString('base64url');
  const inv = await ownerDb.invitationMembre.findFirstOrThrow({
    where: { email, accepteeLe: null, revoqueeLe: null },
  });
  await ownerDb.invitationMembre.update({
    where: { id: inv.id },
    data: { tokenHash: empreinte(jeton) },
  });
  return jeton;
}

async function nettoyer() {
  const comptes = await ownerDb.compte.findMany({
    where: { email: { in: [DT, EXISTANT] } },
    select: { id: true },
  });
  const ids = comptes.map((c) => c.id);
  await ownerDb.operation.updateMany({
    where: { directionTravaux: { compteId: { in: ids } } },
    data: { directionTravauxId: null },
  });
  await ownerDb.operationAccess.deleteMany({ where: { membership: { compteId: { in: ids } } } });
  await ownerDb.membership.deleteMany({ where: { compteId: { in: ids } } });
  await ownerDb.acteur.deleteMany({ where: { email: { in: [DT, EXISTANT] } } });
  await ownerDb.invitationMembre.deleteMany({ where: { email: { in: [DT, EXISTANT] } } });
  await ownerDb.compte.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  await nettoyer();
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  julie = await jetonPourEspace(COMPTES.julie, CB);
  const ops = await ownerDb.operation.findMany({
    where: { societeId: CB },
    orderBy: { id: 'asc' },
  });
  operationId = ops.find((o) => o.nom === 'Les Jardins de Prilly')!.id;
  autreOperation = ops.find((o) => o.id !== operationId)!.id;
});

afterAll(async () => {
  await nettoyer();
  await ownerDb.$disconnect();
});

const invitationDT = {
  email: DT,
  prenom: 'Denise',
  nom: 'Travaux',
  externe: true,
  acteurType: 'DIRECTION_TRAVAUX',
  societeNom: 'DT Conseils SA',
  acces: [] as { operationId: number; accessLevel: string; modules: string[] }[],
  directionTravauxDe: [] as number[],
};

describe('inviter', () => {
  it('réservé aux administrateurs', async () => {
    const r = await appel('/acces/invitations', {
      methode: 'POST',
      token: julie,
      corps: { ...invitationDT, acces: [{ operationId, accessLevel: 'OPERATE', modules: [] }] },
    });
    expect(r.status).toBe(403);
  });

  it('un externe sans promotion : refusé', async () => {
    const r = await appel('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: invitationDT,
    });
    expect(r.status).toBe(400);
  });

  it('une DT en lecture seule ne peut pas viser les factures : refusé', async () => {
    const r = await appel('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: {
        ...invitationDT,
        acces: [{ operationId, accessLevel: 'READ_ONLY', modules: [] }],
        directionTravauxDe: [operationId],
      },
    });
    expect(r.status).toBe(400);
  });

  it('invite une direction des travaux sur une promotion', async () => {
    const r = await appel<{ id: number }>('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: {
        ...invitationDT,
        acces: [
          {
            operationId,
            accessLevel: 'OPERATE',
            modules: ['SOUMISSIONS', 'CONTRATS', 'FACTURES', 'DOCUMENTS'],
          },
        ],
        directionTravauxDe: [operationId],
      },
    });
    expect(r.status).toBe(201);
    const inv = await ownerDb.invitationMembre.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(inv.role).toBe('EXTERNE');
    expect(inv.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const liste = await appel<{ email: string }[]>('/acces/invitations', { token: christophe });
    expect(liste.body.some((i) => i.email === DT)).toBe(true);
  });

  it('un membre existant ne se réinvite pas', async () => {
    const r = await appel('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: { email: COMPTES.julie, externe: false, role: 'COMPTABILITE', acces: [] },
    });
    expect(r.status).toBe(409);
  });
});

describe('accepter', () => {
  let jeton = '';

  it('la page lit l’invitation sans session', async () => {
    jeton = await poserJeton(DT);
    const r = await appel<{ societe: string; compteExistant: boolean; directionTravaux: boolean }>(
      `/invitations/${jeton}`,
    );
    expect(r.status).toBe(200);
    expect(r.body.compteExistant).toBe(false);
    expect(r.body.directionTravaux).toBe(true);
  });

  it('refuse un mot de passe court', async () => {
    const r = await appel(`/invitations/${jeton}/accepter`, {
      methode: 'POST',
      corps: { motDePasse: 'court', prenom: 'D', nom: 'T', prisConnaissance: true },
    });
    expect(r.status).toBe(400);
  });

  it('crée le compte, l’accès et la nomination', async () => {
    const r = await appel(`/invitations/${jeton}/accepter`, {
      methode: 'POST',
      corps: { motDePasse: MDP, prenom: 'Denise', nom: 'Travaux', prisConnaissance: true },
    });
    expect(r.status).toBe(200);
    const m = await ownerDb.membership.findFirstOrThrow({
      where: { compte: { email: DT }, societeId: CB },
      include: { acteur: true, operationAccesses: true },
    });
    expect(m.role).toBe('EXTERNE');
    expect(m.acteur?.type).toBe('DIRECTION_TRAVAUX');
    expect(m.operationAccesses).toHaveLength(1);
    expect(m.operationAccesses[0]!.modules).toContain('FACTURES');
    const op = await ownerDb.operation.findUniqueOrThrow({ where: { id: operationId } });
    expect(op.directionTravauxId).toBe(m.id);
  });

  it('le lien ne sert qu’une fois', async () => {
    const r = await appel(`/invitations/${jeton}/accepter`, {
      methode: 'POST',
      corps: { motDePasse: MDP, prenom: 'X', nom: 'Y', prisConnaissance: true },
    });
    expect(r.status).toBe(404);
  });

  it('la DT ne voit que sa promotion, et pas les ventes', async () => {
    const { accessToken } = await connexion(DT, MDP);
    const ws = await appel<{ accessToken: string }>('/auth/workspace', {
      methode: 'POST',
      token: accessToken,
      corps: { societeId: CB },
    });
    const t = ws.body.accessToken;
    const ops = await appel<{ id: number }[]>('/operations', { token: t });
    expect(ops.body.map((o) => o.id)).toEqual([operationId]);
    const autre = await appel(`/operations/${autreOperation}`, { token: t });
    expect(autre.status).toBe(404);
    const factures = await appel(`/operations/${operationId}/factures`, { token: t });
    expect(factures.status).toBe(200);
    const acces = await appel(`/acces/membres`, { token: t });
    expect(acces.status).toBe(403);
  });
});

describe('compte existant', () => {
  let jeton = '';

  beforeAll(async () => {
    await ownerDb.compte.create({
      data: {
        email: EXISTANT,
        passwordHash: await hash(MDP, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
        prenom: 'Arthur',
        nom: 'Chitecte',
      },
    });
    const r = await appel('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: {
        email: EXISTANT,
        externe: true,
        acteurType: 'ARCHITECTE',
        societeNom: 'Atelier test SA',
        acces: [{ operationId, accessLevel: 'READ_ONLY', modules: [] }],
      },
    });
    expect(r.status).toBe(201);
    jeton = await poserJeton(EXISTANT);
  });

  it('un compte existant prouve qu’il en est titulaire', async () => {
    const lu = await appel<{ compteExistant: boolean }>(`/invitations/${jeton}`);
    expect(lu.body.compteExistant).toBe(true);
    const faux = await appel(`/invitations/${jeton}/accepter`, {
      methode: 'POST',
      corps: { motDePasse: 'pas-le-bon-mot-de-passe', prisConnaissance: true },
    });
    expect(faux.status).toBe(401);
    const bon = await appel(`/invitations/${jeton}/accepter`, {
      methode: 'POST',
      corps: { motDePasse: MDP, prisConnaissance: true },
    });
    expect(bon.status).toBe(200);
    expect(
      await ownerDb.membership.count({ where: { compte: { email: EXISTANT }, societeId: CB } }),
    ).toBe(1);
  });

  it('une invitation révoquée ne s’ouvre plus', async () => {
    const r = await appel<{ id: number }>('/acces/invitations', {
      methode: 'POST',
      token: christophe,
      corps: {
        email: 'test-invitation-revoquee@exemple.ch',
        externe: false,
        role: 'LECTURE_SEULE',
        acces: [],
      },
    });
    const j = await poserJeton('test-invitation-revoquee@exemple.ch');
    await appel(`/acces/invitations/${r.body.id}/revoquer`, { methode: 'POST', token: christophe });
    expect((await appel(`/invitations/${j}`)).status).toBe(404);
    await ownerDb.invitationMembre.deleteMany({
      where: { email: 'test-invitation-revoquee@exemple.ch' },
    });
  });
});
