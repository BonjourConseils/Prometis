/**
 * Contrôle des factures — de la pièce déposée au rapport, puis aux visas.
 * Sans IA en test : la lecture locale (motifs) remplit les champs, le
 * contrôle est le même.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe = '';
let julie = '';
let operationId = 0;
let factureId = 0;
let piece: Buffer;

function pdfFacture(lignes: string[]): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument();
    const morceaux: Buffer[] = [];
    doc.on('data', (b: Buffer) => morceaux.push(b));
    doc.on('end', () => ok(Buffer.concat(morceaux)));
    for (const l of lignes) doc.text(l);
    doc.end();
  });
}

const FACTURE = [
  'Maconnerie Test SA',
  'Rue du Chantier 1, 1000 Lausanne',
  'Facture n° T-4821',
  'Date : 10.09.2026',
  'Situation no 4 - CFC 211 Maconnerie',
  "Total HT CHF 187'430.00",
  "TVA 8.1 % CHF 15'181.83",
  "Total TTC CHF 202'611.83",
  'IBAN CH93 0076 2011 6238 5295 7',
];

async function deposer(
  fichiers: { nom: string; octets: Buffer; type: string }[],
  token = christophe,
) {
  const form = new FormData();
  for (const f of fichiers) form.append('fichiers', new Blob([new Uint8Array(f.octets)], { type: f.type }), f.nom);
  const res = await fetch(`${API}/operations/${operationId}/factures/depots`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      resultats: { statut: string; factureId?: number; raison?: string }[];
    },
  };
}

async function attendreLecture(id: number) {
  for (let i = 0; i < 50; i++) {
    const f = await ownerDb.facture.findUniqueOrThrow({ where: { id } });
    if (f.statut !== 'EN_LECTURE') return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Lecture trop longue');
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  julie = await jetonPourEspace(COMPTES.julie, CB);
  const op = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable factures — test', commune: 'Prilly' },
  });
  operationId = op.body.id;
});

afterAll(async () => {
  if (operationId) {
    await ownerDb.operation.update({
      where: { id: operationId },
      data: { directionTravauxId: null },
    });
    await supprimerOperationDeTest(operationId);
  }
  await ownerDb.$disconnect();
});

describe('déposer', () => {
  it('une pièce qui n’est ni PDF ni image : refusée, sans rien créer', async () => {
    const r = await deposer([
      { nom: 'facture.pdf', octets: Buffer.from('pas un pdf'), type: 'application/pdf' },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.resultats[0]!.statut).toBe('refusee');
  });

  it('un PDF est reçu, conservé, puis lu en arrière-plan', async () => {
    piece = await pdfFacture(FACTURE);
    const r = await deposer([{ nom: 'T-4821.pdf', octets: piece, type: 'application/pdf' }]);
    expect(r.body.resultats[0]!.statut).toBe('recue');
    factureId = r.body.resultats[0]!.factureId!;
    const f = await attendreLecture(factureId);
    expect(f.lectureErreur).toBeNull();
    expect(f.statut).toBe('A_VALIDER');
    expect(f.source).toBe('UPLOAD');
    expect(f.fichierSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.numero).toBe('T-4821');
    expect(f.montantHT?.toString()).toBe('187430');
    expect(f.iban).toBe('CH9300762011623852957');
    expect(f.lectureMethode).toBe('texte-pdf');
    expect(await ownerDb.document.count({ where: { factureId } })).toBe(1);
  });

  it('le rapport de contrôle est prêt, et dit l’absence de contrat', async () => {
    const d = await appel<{
      controles: { constats: { code: string }[]; resume: string[] };
      lecture: { champs: Record<string, { ancrage: string }> };
    }>(`/operations/${operationId}/factures/${factureId}`, { token: christophe });
    expect(d.status).toBe(200);
    expect(d.body.controles.resume[0]).toBe('Facture n° T-4821 analysée.');
    expect(d.body.controles.constats.map((c) => c.code)).toContain('sans_contrat');
    expect(d.body.lecture.champs.montantHT!.ancrage).toBe('ancree');
    expect(JSON.stringify(d.body)).not.toContain('ocrTexte');
  });

  it('la même pièce redéposée : doublon, pas une seconde facture', async () => {
    const r = await deposer([
      { nom: 'copie.pdf', octets: piece, type: 'application/pdf' },
    ]);
    expect(r.body.resultats[0]).toMatchObject({ statut: 'doublon', factureId });
  });

  it('la pièce se télécharge, servie sans risque', async () => {
    const res = await fetch(`${API}/operations/${operationId}/factures/${factureId}/fichier`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });

  it('une correction relance le contrôle', async () => {
    const r = await appel(`/operations/${operationId}/factures/${factureId}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { tvaPct: '7.7' },
    });
    expect(r.status).toBe(200);
    const f = await ownerDb.facture.findUniqueOrThrow({ where: { id: factureId } });
    expect(JSON.stringify(f.controles)).toContain('tva_ancienne');
    await appel(`/operations/${operationId}/factures/${factureId}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { tvaPct: '8.1' },
    });
  });
});

describe('le circuit : direction des travaux, puis promoteur', () => {
  let cfcNodeId = 0;

  beforeAll(async () => {
    const n = await appel<{ id: number }>(`/operations/${operationId}/cfc`, {
      methode: 'POST',
      token: christophe,
      corps: { code: '211', libelle: 'Maçonnerie' },
    });
    cfcNodeId = n.body.id;
    // Julie (cheffe de projet) reçoit l'accès, puis est nommée DT.
    const julieM = await ownerDb.membership.findFirstOrThrow({
      where: { compte: { email: COMPTES.julie }, societeId: CB },
    });
    await appel(`/acces/operations/${operationId}/membres/${julieM.id}`, {
      methode: 'PUT',
      token: christophe,
      corps: { accessLevel: 'OPERATE', modules: [] },
    });
    const r = await appel(`/acces/operations/${operationId}/direction-travaux`, {
      methode: 'PUT',
      token: christophe,
      corps: { membershipId: julieM.id },
    });
    expect(r.status).toBe(200);
  });

  it('le promoteur ne valide pas avant le visa de la DT', async () => {
    const r = await appel<{ message: string }>(
      `/operations/${operationId}/factures/${factureId}/validation`,
      {
        methode: 'POST',
        token: christophe,
        corps: { cfcNodeId, forcer: true },
      },
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/direction des travaux doit d’abord viser/);
  });

  it('seule la DT nommée vise', async () => {
    const r = await appel(
      `/operations/${operationId}/factures/${factureId}/visa-direction-travaux`,
      {
        methode: 'POST',
        token: christophe,
        corps: { decision: 'APPROUVE' },
      },
    );
    expect(r.status).toBe(403);
  });

  it('un refus s’explique, et met la facture en litige', async () => {
    const sans = await appel(
      `/operations/${operationId}/factures/${factureId}/visa-direction-travaux`,
      {
        methode: 'POST',
        token: julie,
        corps: { decision: 'REFUSE' },
      },
    );
    expect(sans.status).toBe(400);
    const avec = await appel(
      `/operations/${operationId}/factures/${factureId}/visa-direction-travaux`,
      {
        methode: 'POST',
        token: julie,
        corps: { decision: 'REFUSE', commentaire: 'Chapes non exécutées à ce jour.' },
      },
    );
    expect(avec.status).toBe(200);
    expect((await ownerDb.facture.findUniqueOrThrow({ where: { id: factureId } })).statut).toBe(
      'LITIGE',
    );
  });

  it('visée favorablement, elle se valide — et les deux visas restent', async () => {
    await appel(`/operations/${operationId}/factures/${factureId}/visa-direction-travaux`, {
      methode: 'POST',
      token: julie,
      corps: { decision: 'APPROUVE', commentaire: 'Conforme après vérification.' },
    });
    const r = await appel(`/operations/${operationId}/factures/${factureId}/validation`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId, forcer: true },
    });
    expect(r.status).toBe(200);
    const visas = await ownerDb.factureVisa.findMany({
      where: { factureId },
      orderBy: { id: 'asc' },
    });
    expect(visas.map((v) => `${v.etape}:${v.decision}`)).toEqual([
      'DIRECTION_TRAVAUX:REFUSE',
      'DIRECTION_TRAVAUX:APPROUVE',
      'PROMOTEUR:APPROUVE',
    ]);
  });
});
