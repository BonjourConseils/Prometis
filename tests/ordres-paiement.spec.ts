/**
 * L'ordre de paiement, de bout en bout contre l'API.
 *
 * Le geste vient du terrain : « Ordre de paiement n° 11 » chez CB Promotions.
 * La comptabilité compose, le promoteur vise, le fichier part à la banque —
 * et rien ne sort deux fois.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let operationId = 0;
let entrepriseId = 0;
const factures: number[] = [];

/** Coutaz : QR-IBAN et référence QR. Procéram : IBAN ordinaire, sans référence. */
const PIECES = [
  {
    numero: 'F-33479',
    iban: 'CH0830808006035644850',
    referenceQR: '000000000083620000334791006',
    montantTTC: '39600.00',
  },
  {
    numero: 'F-24633',
    iban: 'CH880026526563820901K',
    referenceQR: null,
    montantTTC: '50000.00',
  },
];

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);

  const op = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable ordres de paiement — test', commune: 'Martigny' },
  });
  operationId = op.body.id;

  const entreprise = await ownerDb.entreprise.create({
    data: { societeId: CB, nom: 'Coutaz Toiture SA', corpsMetier: 'Ferblanterie' },
  });
  entrepriseId = entreprise.id;

  for (const p of PIECES) {
    const f = await ownerDb.facture.create({
      data: {
        societeId: CB,
        operationId,
        entrepriseId,
        statut: 'VALIDEE',
        type: 'SITUATION',
        numero: p.numero,
        dateFacture: new Date('2026-09-01'),
        montantTTC: p.montantTTC,
        iban: p.iban,
        referenceQR: p.referenceQR,
      },
    });
    factures.push(f.id);
  }
});

afterAll(async () => {
  await ownerDb.ligneOrdrePaiement.deleteMany({ where: { ordre: { operationId } } });
  await ownerDb.ordrePaiement.deleteMany({ where: { operationId } });
  await ownerDb.paiementFournisseur.deleteMany({ where: { facture: { operationId } } });
  await ownerDb.facture.deleteMany({ where: { operationId } });
  if (entrepriseId) await ownerDb.entreprise.delete({ where: { id: entrepriseId } });
  if (operationId) await supprimerOperationDeTest(operationId);
  await ownerDb.$disconnect();
});

const corps = (extra: Record<string, unknown> = {}) => ({
  factureIds: factures,
  libelle: 'Ordre de paiement n° 1',
  dateExecution: '2026-09-30',
  ...extra,
});

describe('le compte de la promotion', () => {
  it('sans compte, aucun ordre ne se compose', async () => {
    const r = await appel(`/operations/${operationId}/ordres-paiement`, {
      methode: 'POST',
      token: christophe,
      corps: corps(),
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/compte de la promotion/);
  });

  it('un IBAN faux est refusé avant d’entrer en base', async () => {
    const r = await appel(`/operations/${operationId}/ordres-paiement/compte`, {
      methode: 'PUT',
      token: christophe,
      corps: { iban: 'pas un iban' },
    });
    expect(r.status).toBe(400);
  });

  it('le compte se renseigne, et il est journalisé', async () => {
    const r = await appel<{ ibanPaiement: string }>(
      `/operations/${operationId}/ordres-paiement/compte`,
      { methode: 'PUT', token: christophe, corps: { iban: 'CH93 0076 2011 6238 5295 7' } },
    );
    expect(r.status).toBe(200);
    expect(r.body.ibanPaiement).toBe('CH9300762011623852957');
    const trace = await ownerDb.auditLog.findFirst({
      where: { action: 'ordre_paiement.compte_fixe', entiteId: operationId },
    });
    expect(trace).not.toBeNull();
  });
});

describe('ce qui attend d’être payé', () => {
  it('les factures validées, avec ce qu’il reste à payer', async () => {
    const r = await appel<{ id: number; montant: string; manque: string[] }[]>(
      `/operations/${operationId}/ordres-paiement/a-payer`,
      { token: christophe },
    );
    expect(r.body).toHaveLength(2);
    expect(r.body.map((f) => f.montant)).toEqual(['39600.00', '50000.00']);
    expect(r.body.every((f) => f.manque.length === 0)).toBe(true);
  });
});

describe('composer, viser, transmettre', () => {
  let ordreId = 0;

  it('la comptabilité compose l’ordre : il est en brouillon, numéroté', async () => {
    const r = await appel<{ id: number; numero: number; statut: string }>(
      `/operations/${operationId}/ordres-paiement`,
      { methode: 'POST', token: christophe, corps: corps() },
    );
    expect(r.status).toBe(201);
    expect(r.body.numero).toBe(1);
    expect(r.body.statut).toBe('BROUILLON');
    ordreId = r.body.id;
  });

  it('une facture déjà dans un ordre vivant n’y entre pas deux fois', async () => {
    const r = await appel(`/operations/${operationId}/ordres-paiement`, {
      methode: 'POST',
      token: christophe,
      corps: corps({ factureIds: [factures[0]] }),
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/figure déjà dans l’ordre n° 1/);
  });

  it('avant le visa, aucun fichier ne se télécharge', async () => {
    const r = await fetch(`${API}/operations/${operationId}/ordres-paiement/${ordreId}/fichier`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(r.status).toBe(400);
  });

  it('l’ordre se relit, avec son total et ses éventuelles anomalies', async () => {
    const r = await appel<{ total: string; anomalies: string[]; statut: string }>(
      `/operations/${operationId}/ordres-paiement/${ordreId}`,
      { token: christophe },
    );
    expect(r.body.total).toBe('89600.00');
    expect(r.body.anomalies).toEqual([]);
  });

  it('le promoteur vise : la trace dit qui, quand et combien', async () => {
    const r = await appel<{ statut: string; viseLe: string }>(
      `/operations/${operationId}/ordres-paiement/${ordreId}/visa`,
      { methode: 'POST', token: christophe },
    );
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('VISE');
    const trace = await ownerDb.auditLog.findFirst({
      where: { action: 'ordre_paiement.vise', entiteId: ordreId },
    });
    expect((trace?.donnees as { total?: string })?.total).toBe('89600.00');
  });

  it('un ordre visé ne se vise pas deux fois', async () => {
    const r = await appel(`/operations/${operationId}/ordres-paiement/${ordreId}/visa`, {
      methode: 'POST',
      token: christophe,
    });
    expect(r.status).toBe(400);
  });

  it('le fichier part : pain.001, QR-facture et communication libre', async () => {
    const r = await fetch(`${API}/operations/${operationId}/ordres-paiement/${ordreId}/fichier`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('ordre-paiement-1.xml');
    const xml = await r.text();
    expect(xml).toContain('pain.001.001.09');
    expect(xml).toContain('<CtrlSum>89600.00</CtrlSum>');
    expect(xml).toContain('<Prtry>QRR</Prtry>');
    expect(xml).toContain('<IBAN>CH9300762011623852957</IBAN>'); // le compte de la promotion
    expect(xml).toMatch(/<Ustrd>Facture F-24633<\/Ustrd>/);
  });

  it('les factures sont payées, et le fil rouge a bougé', async () => {
    const payees = await ownerDb.facture.findMany({
      where: { operationId },
      select: { statut: true },
    });
    expect(payees.every((f) => f.statut === 'PAYEE')).toBe(true);
    const paiements = await ownerDb.paiementFournisseur.findMany({
      where: { facture: { operationId } },
    });
    expect(paiements).toHaveLength(2);
    expect(paiements[0]!.moyen).toBe('virement');
  });

  it('retélécharger rend le même fichier, avec le même identifiant de message', async () => {
    const ordre = await ownerDb.ordrePaiement.findUniqueOrThrow({ where: { id: ordreId } });
    const r = await fetch(`${API}/operations/${operationId}/ordres-paiement/${ordreId}/fichier`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    const xml = await r.text();
    expect(xml).toContain(`<MsgId>${ordre.messageId}</MsgId>`);
    // Rien n'a été payé une seconde fois.
    expect(await ownerDb.paiementFournisseur.count({ where: { facture: { operationId } } })).toBe(
      2,
    );
  });

  it('un ordre transmis ne s’annule plus dans Prometis', async () => {
    const r = await appel(`/operations/${operationId}/ordres-paiement/${ordreId}/annulation`, {
      methode: 'POST',
      token: christophe,
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/e-banking/);
  });

  it('les factures payées ne réapparaissent plus dans ce qui attend', async () => {
    const r = await appel<unknown[]>(`/operations/${operationId}/ordres-paiement/a-payer`, {
      token: christophe,
    });
    expect(r.body).toHaveLength(0);
  });
});
