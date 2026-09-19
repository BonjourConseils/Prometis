/**
 * Appels d'offres — la consultation de bout en bout, contre l'API.
 *
 * Deux entreprises invitées sur une opération bac à sable. On ne lit pas les
 * e-mails : le lien et le code sont posés en base sous forme d'empreinte,
 * exactement comme l'API le ferait, puis tout passe par les routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';
import {
  empreinteCode,
  empreinteJeton,
  genererJeton,
  secretSession,
} from '../apps/api/src/soumissions/consultation-regles';

let christophe = '';
let operationId = 0;
let soumissionId = 0;
const entreprises: number[] = [];
const invitations: number[] = [];
const jetons: string[] = [];
const sessions: string[] = [];
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

const secret = () => secretSession(process.env.JWT_SECRET!);

async function poserCode(i: number, code: string) {
  await ownerDb.soumissionInvitation.update({
    where: { id: invitations[i] },
    data: {
      codeHash: empreinteCode(code, invitations[i]!, secret()),
      codeExpireLe: new Date(Date.now() + 10 * 60_000),
      codeEssais: 0,
    },
  });
}

function espace(i: number, chemin = '', options: RequestInit = {}) {
  return fetch(`${API}/consultation/${jetons[i]}${chemin}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(sessions[i] ? { 'x-consultation-session': sessions[i]! } : {}),
      ...(options.headers ?? {}),
    },
  });
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  const op = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable consultation — test', commune: 'Prilly' },
  });
  operationId = op.body.id;
  for (const nom of ['Plâtrerie Test A', 'Plâtrerie Test B']) {
    const e = await appel<{ id: number }>('/entreprises', {
      methode: 'POST',
      token: christophe,
      corps: {
        nom,
        corpsMetier: 'plâtrerie',
        email: `${nom.slice(-1).toLowerCase()}@test-consultation.ch`,
      },
    });
    entreprises.push(e.body.id);
  }
});

afterAll(async () => {
  if (operationId) await supprimerOperationDeTest(operationId);
  await ownerDb.entreprise.deleteMany({ where: { id: { in: entreprises } } });
  await ownerDb.$disconnect();
});

describe('préparer et envoyer', () => {
  it('refuse d’envoyer un dossier vide ou sans date limite', async () => {
    const s = await appel<{ id: number }>(`/operations/${operationId}/soumissions`, {
      methode: 'POST',
      token: christophe,
      corps: { intitule: 'Plâtrerie — test consultation' },
    });
    soumissionId = s.body.id;
    for (const e of entreprises) {
      await appel(`/operations/${operationId}/soumissions/${soumissionId}/invitations/${e}`, {
        methode: 'POST',
        token: christophe,
      });
    }
    const r = await appel(`/operations/${operationId}/soumissions/${soumissionId}/envoyer`, {
      methode: 'POST',
      token: christophe,
      corps: {},
    });
    expect(r.status).toBe(400);
  });

  it('envoie à chaque entreprise un lien personnel', async () => {
    await appel(`/operations/${operationId}/soumissions/${soumissionId}`, {
      methode: 'PATCH',
      token: christophe,
      corps: {
        descriptif: 'Crépis et enduits intérieurs, 1 200 m².',
        conditions: 'Norme SIA 118. Retenue de garantie 10 %.',
        dateLimite: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    });
    const r = await appel<{ envoyees: string[]; sansEmail: string[] }>(
      `/operations/${operationId}/soumissions/${soumissionId}/envoyer`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(r.status).toBe(200);
    expect(r.body.envoyees).toHaveLength(2);
    const invs = await ownerDb.soumissionInvitation.findMany({
      where: { soumissionId },
      orderBy: { entrepriseId: 'asc' },
    });
    expect(invs.every((i) => i.jetonHash && i.email)).toBe(true);
    // Le lien envoyé est inconnu de la base ; on en pose un connu, en empreinte.
    for (const inv of invs) {
      const jeton = genererJeton();
      await ownerDb.soumissionInvitation.update({
        where: { id: inv.id },
        data: { jetonHash: empreinteJeton(jeton) },
      });
      invitations.push(inv.id);
      jetons.push(jeton);
    }
  });
});

describe('entrer dans l’espace entreprise', () => {
  it('un lien inconnu ne dit rien de plus qu’un lien révoqué', async () => {
    const r = await fetch(`${API}/consultation/${genererJeton()}/code`, { method: 'POST' });
    expect(r.status).toBe(404);
  });

  it('demander un code répond sans révéler l’adresse entière', async () => {
    const r = await espace(0, '/code', { method: 'POST' });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { email: string };
    expect(body.email).toBe('a•••@test-consultation.ch');
  });

  it('sans session, le dossier reste fermé', async () => {
    expect((await espace(0)).status).toBe(401);
  });

  it('un mauvais code est refusé, et brûlé au cinquième essai', async () => {
    await poserCode(0, '123456');
    const faux = await espace(0, '/session', {
      method: 'POST',
      body: JSON.stringify({ code: '000000' }),
    });
    expect(faux.status).toBe(401);
    const inv = await ownerDb.soumissionInvitation.findUniqueOrThrow({
      where: { id: invitations[0] },
    });
    expect(inv.codeEssais).toBe(1);
  });

  it('le bon code ouvre une session — et ne sert qu’une fois', async () => {
    for (const i of [0, 1]) {
      await poserCode(i, '424242');
      const r = await espace(i, '/session', {
        method: 'POST',
        body: JSON.stringify({ code: '424242' }),
      });
      expect(r.status).toBe(200);
      sessions[i] = ((await r.json()) as { session: string }).session;
    }
    const encore = await espace(0, '/session', {
      method: 'POST',
      body: JSON.stringify({ code: '424242' }),
    });
    expect(encore.status).toBe(401);
  });

  it('une session ne vaut que pour son propre lien', async () => {
    const croisee = await fetch(`${API}/consultation/${jetons[1]}`, {
      headers: { 'x-consultation-session': sessions[0]! },
    });
    expect(croisee.status).toBe(401);
  });

  it('une session entreprise n’ouvre pas l’application', async () => {
    const r = await appel('/operations', { token: sessions[0] });
    expect(r.status).toBe(401);
  });

  it('le dossier montre la consultation, pas les autres invités', async () => {
    const r = await espace(0);
    expect(r.status).toBe(200);
    const d = (await r.json()) as Record<string, unknown> & {
      soumission: { descriptif: string };
      depotOuvert: boolean;
    };
    expect(d.soumission.descriptif).toContain('1 200 m²');
    expect(d.depotOuvert).toBe(true);
    expect(JSON.stringify(d)).not.toContain('Plâtrerie Test B');
  });
});

describe('questions et dépôt', () => {
  it('une question publiée part à tous, sans le nom de qui l’a posée', async () => {
    const q = await espace(0, '/questions', {
      method: 'POST',
      body: JSON.stringify({ question: 'Les angles sont-ils compris dans le métré ?' }),
    });
    expect(q.status).toBe(201);
    const { id } = (await q.json()) as { id: number };
    const r = await appel(
      `/operations/${operationId}/soumissions/${soumissionId}/questions/${id}/reponse`,
      {
        methode: 'POST',
        token: christophe,
        corps: { reponse: 'Oui, au mètre linéaire.', publier: true },
      },
    );
    expect(r.status).toBe(200);
    const vueB = (await (await espace(1)).json()) as {
      questions: { reponse: string; mienne: boolean }[];
    };
    expect(vueB.questions).toHaveLength(1);
    expect(vueB.questions[0]!.mienne).toBe(false);
    expect(JSON.stringify(vueB.questions)).not.toContain('Test A');
  });

  it('le dépôt exige un vrai PDF', async () => {
    const form = new FormData();
    form.append('montant', '180000');
    form.append('fichier', new Blob(['pas un pdf']), 'offre.pdf');
    const r = await espace(0, '/offre', { method: 'POST', body: form });
    expect(r.status).toBe(400);
  });

  it('les deux entreprises déposent ; l’offre est scellée pour le promoteur', async () => {
    for (const [i, montant] of [
      [0, '180000'],
      [1, '165000'],
    ] as const) {
      const form = new FormData();
      form.append('montant', montant);
      form.append('remisePct', '2');
      form.append(
        'lignes',
        JSON.stringify([{ type: 'OPTION', libelle: 'Angles renforcés', montant: '4000' }]),
      );
      form.append('fichier', new Blob([PDF], { type: 'application/pdf' }), `offre-${i}.pdf`);
      const r = await espace(i, '/offre', { method: 'POST', body: form });
      expect(r.status).toBe(200);
    }
    const c = await appel<{
      offres: { scellee: boolean; montantBrut: string | null; lignes: unknown[] }[];
      adjudicable: boolean;
    }>(`/operations/${operationId}/soumissions/${soumissionId}/comparaison`, { token: christophe });
    expect(c.body.offres).toHaveLength(2);
    expect(
      c.body.offres.every((o) => o.scellee && o.montantBrut === null && !o.lignes.length),
    ).toBe(true);
    expect(c.body.adjudicable).toBe(false);
  });

  it('la GED ne montre pas un pli scellé', async () => {
    const docs = await appel<{ offreId: number | null }[]>(`/operations/${operationId}/documents`, {
      token: christophe,
    });
    expect(docs.body.some((d) => d.offreId !== null)).toBe(false);
  });

  it('adjuger avant l’ouverture : refusé', async () => {
    const offre = await ownerDb.offre.findFirstOrThrow({ where: { soumissionId } });
    const r = await appel(`/operations/${operationId}/soumissions/${soumissionId}/adjudication`, {
      methode: 'POST',
      token: christophe,
      corps: { offreId: offre.id },
    });
    expect(r.status).toBe(400);
  });

  it('avancer la date limite après l’envoi : refusé', async () => {
    const r = await appel(`/operations/${operationId}/soumissions/${soumissionId}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { dateLimite: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(r.status).toBe(400);
  });
});

describe('après la date limite', () => {
  it('les offres s’ouvrent toutes ensemble', async () => {
    await ownerDb.soumission.update({
      where: { id: soumissionId },
      data: { dateLimite: new Date(Date.now() - 60_000) },
    });
    const c = await appel<{
      offres: { id: number; scellee: boolean; montantNet: string; lignes: { id: number }[] }[];
      adjudicable: boolean;
    }>(`/operations/${operationId}/soumissions/${soumissionId}/comparaison`, { token: christophe });
    expect(c.body.offres.every((o) => !o.scellee)).toBe(true);
    expect(c.body.adjudicable).toBe(true);
  });

  it('le dépôt est fermé côté entreprise', async () => {
    const form = new FormData();
    form.append('montant', '100000');
    form.append('fichier', new Blob([PDF], { type: 'application/pdf' }), 'tard.pdf');
    const r = await espace(0, '/offre', { method: 'POST', body: form });
    expect(r.status).toBe(403);
  });

  it('l’adjudication retient l’option, remise déduite', async () => {
    const offre = await ownerDb.offre.findFirstOrThrow({
      where: { soumissionId, entrepriseId: entreprises[1] },
      include: { lignes: true },
    });
    const r = await appel<{ montantAdjuge: string }>(
      `/operations/${operationId}/soumissions/${soumissionId}/adjudication`,
      {
        methode: 'POST',
        token: christophe,
        corps: { offreId: offre.id, lignesRetenues: [offre.lignes[0]!.id] },
      },
    );
    expect(r.status).toBe(201);
    // (165 000 + 4 000) × 0.98
    expect(Number(r.body.montantAdjuge)).toBe(165620);
  });

  it('une pièce déposée par une entreprise ne se supprime pas depuis la GED', async () => {
    const doc = await ownerDb.document.findFirstOrThrow({
      where: { soumissionId, offreId: { not: null } },
    });
    const r = await appel(`/operations/${operationId}/documents/${doc.id}`, {
      methode: 'DELETE',
      token: christophe,
    });
    expect(r.status).toBe(400);
  });

  it('un accès révoqué ferme la session en cours', async () => {
    await appel(
      `/operations/${operationId}/soumissions/${soumissionId}/invitations/${invitations[0]}/revoquer`,
      { methode: 'POST', token: christophe },
    );
    expect((await espace(0)).status).toBe(401);
  });
});
