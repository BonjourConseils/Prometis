/**
 * Le passeport numérique, contre l'API : module, liens, propositions,
 * export, et ce qui reste après résiliation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { API, COMPTES, CB, CONSTRUCTA, apiDisponible, appel, jetonPourEspace } from './api-client';
import { asTenant, ownerDb } from './tenant-db';

let christophe = '';
let operationId = 0;
let autreOperationLot = 0;
let lotId = 0;
let contratId = 0;
let entrepriseDuContrat = 0;
let equipementId = 0;
let documentNotice = 0;

async function deposerNotice(): Promise<number> {
  const form = new FormData();
  const texte = 'Notice — Pompe à chaleur Vitocal 250-A. Garantie : 5 ans. Entretien annuel.';
  form.append('fichier', new Blob([texte], { type: 'text/plain' }), 'test-passeport-notice.txt');
  form.append('titre', 'test-passeport — notice PAC');
  form.append('categorie', 'NOTICE');
  const res = await fetch(`${API}/operations/${operationId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${christophe}` },
    body: form,
  });
  return ((await res.json()) as { id: number }).id;
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  const op = await ownerDb.operation.findFirstOrThrow({ where: { nom: 'Les Jardins de Prilly' } });
  operationId = op.id;
  lotId = (
    await ownerDb.lot.findFirstOrThrow({ where: { bien: { operationId }, reference: 'A02' } })
  ).id;
  const contrat = await ownerDb.contrat.findFirstOrThrow({ where: { operationId } });
  contratId = contrat.id;
  entrepriseDuContrat = contrat.entrepriseId;
  // Un lot d'une AUTRE opération de la société, pour le contrôle d'appartenance.
  const autre = await ownerDb.operation.create({
    data: { societeId: CB, nom: 'test-passeport — autre opération' },
  });
  const bien = await ownerDb.bien.create({ data: { operationId: autre.id, nom: 'B' } });
  autreOperationLot = (await ownerDb.lot.create({ data: { bienId: bien.id, reference: 'Z1' } })).id;
});

afterAll(async () => {
  await ownerDb.equipement.deleteMany({ where: { operationId } });
  await ownerDb.document.deleteMany({ where: { fileName: { startsWith: 'test-passeport' } } });
  await ownerDb.lot.deleteMany({
    where: { reference: 'Z1', bien: { operation: { nom: 'test-passeport — autre opération' } } },
  });
  await ownerDb.bien.deleteMany({
    where: { operation: { nom: 'test-passeport — autre opération' } },
  });
  await ownerDb.operation.deleteMany({ where: { nom: 'test-passeport — autre opération' } });
  await ownerDb.souscriptionModule.deleteMany({ where: { societeId: CB, module: 'PASSEPORT' } });
  await ownerDb.auditLog.deleteMany({
    where: { OR: [{ entite: 'Equipement' }, { action: { startsWith: 'passeport.' } }] },
  });
  await appel('/modules', { token: christophe }); // recalcul des modules de CB
  await ownerDb.$disconnect();
});

describe('Le module', () => {
  it('fermé tant qu’il n’est pas souscrit', async () => {
    const res = await appel<{ message: string }>(`/operations/${operationId}/passeport`, {
      token: christophe,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain("n'est pas activé");
  });

  it('ouvert dès la souscription, sans autre geste', async () => {
    await ownerDb.souscriptionModule.create({
      data: { societeId: CB, module: 'PASSEPORT', statut: 'ACTIF', source: 'ADMIN' },
    });
    const res = await appel<{ iaDisponible: boolean; completude: { presente: boolean }[] }>(
      `/operations/${operationId}/passeport`,
      { token: christophe },
    );
    expect(res.status).toBe(200);
    expect(res.body.completude.length).toBeGreaterThan(0);
  });
});

describe('Les équipements', () => {
  it('refuse un lot d’une autre opération — la RLS ne garantit que le tenant', async () => {
    const res = await appel(`/operations/${operationId}/passeport/equipements`, {
      methode: 'POST',
      token: christophe,
      corps: { categorie: 'CHAUFFAGE', designation: 'Intrus', lotId: autreOperationLot },
    });
    expect(res.status).toBe(404);
  });

  it('un contrat désigné apporte son entreprise — c’est d’elle que vient la garantie', async () => {
    const res = await appel<{ id: number; entrepriseId: number; statut: string }>(
      `/operations/${operationId}/passeport/equipements`,
      {
        methode: 'POST',
        token: christophe,
        corps: {
          categorie: 'CHAUFFAGE',
          designation: 'Pompe à chaleur',
          lotId,
          contratId,
          garantieFabricantFin: '2031-06-15',
          dateMiseEnService: '2026-06-15',
          entretienPeriodiciteMois: 12,
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.entrepriseId).toBe(entrepriseDuContrat);
    expect(res.body.statut).toBe('VALIDE');
    equipementId = res.body.id;
  });

  it('les échéances en découlent, calculées — garantie et entretien', async () => {
    const res = await appel<{ echeances: { type: string; equipementId?: number }[] }>(
      `/operations/${operationId}/passeport`,
      { token: christophe },
    );
    const siennes = res.body.echeances
      .filter((e) => e.equipementId === equipementId)
      .map((e) => e.type);
    expect(siennes.sort()).toEqual(['ENTRETIEN', 'GARANTIE_FABRICANT']);
  });

  it('une notice se rattache à l’équipement dans la GED', async () => {
    documentNotice = await deposerNotice();
    const res = await appel(`/operations/${operationId}/documents/${documentNotice}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { equipementId },
    });
    expect(res.status).toBe(200);
  });
});

describe('Les propositions', () => {
  it('sans IA configurée, la proposition le dit — et la saisie manuelle reste', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${operationId}/passeport/propositions`,
      {
        methode: 'POST',
        token: christophe,
        corps: { documentId: documentNotice },
      },
    );
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('saisie manuelle');
    // Aucun nom de variable d'environnement ne fuit dans le message.
    expect(res.body.message).not.toMatch(/INFOMANIAK|TOKEN/);
  });

  it('une proposition n’existe pas dans le passeport tant qu’elle n’est pas validée', async () => {
    // Ce que l'IA aurait produit, posé directement : une ligne PROPOSE qui cite sa source.
    const proposee = await ownerDb.equipement.create({
      data: {
        operationId,
        categorie: 'CHAUFFAGE',
        designation: 'Pompe à chaleur Vitocal',
        statut: 'PROPOSE',
        sourceDocumentId: documentNotice,
        sourceExtrait: 'Pompe à chaleur Vitocal 250-A',
      },
    });
    const res = await appel<{ equipements: { id: number }[]; propositions: { id: number }[] }>(
      `/operations/${operationId}/passeport`,
      { token: christophe },
    );
    expect(res.body.equipements.map((e) => e.id)).not.toContain(proposee.id);
    expect(res.body.propositions.map((e) => e.id)).toContain(proposee.id);

    const validee = await appel<{ statut: string; valideParId: number; marque: string }>(
      `/operations/${operationId}/passeport/equipements/${proposee.id}/valider`,
      { methode: 'POST', token: christophe, corps: { marque: 'Viessmann' } },
    );
    expect(validee.body.statut).toBe('VALIDE');
    expect(validee.body.valideParId).toBeTruthy();
    expect(validee.body.marque).toBe('Viessmann');
  });

  it('un équipement validé ne se « rejette » pas — il se supprime', async () => {
    const res = await appel(
      `/operations/${operationId}/passeport/equipements/${equipementId}/rejeter`,
      {
        methode: 'POST',
        token: christophe,
      },
    );
    expect(res.status).toBe(400);
  });

  it('une proposition rejetée disparaît', async () => {
    const p = await ownerDb.equipement.create({
      data: { operationId, categorie: 'AUTRE', designation: 'À rejeter', statut: 'PROPOSE' },
    });
    await appel(`/operations/${operationId}/passeport/equipements/${p.id}/rejeter`, {
      methode: 'POST',
      token: christophe,
    });
    expect(await ownerDb.equipement.findUnique({ where: { id: p.id } })).toBeNull();
  });
});

describe('L’export — le dossier de l’ouvrage', () => {
  it('une archive avec l’index et les pièces, rangées par catégorie', async () => {
    const res = await fetch(`${API}/operations/${operationId}/passeport/export`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const fichiers = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const noms = Object.keys(fichiers);
    expect(noms).toContain('index.pdf');
    expect(noms.some((n) => n.startsWith('documents/notice/'))).toBe(true);
    expect(new TextDecoder().decode(fichiers['index.pdf']!.subarray(0, 5))).toBe('%PDF-');
  });

  it('l’export est journalisé', async () => {
    const trace = await ownerDb.auditLog.findFirst({
      where: { action: 'passeport.exporte', entiteId: operationId },
    });
    expect(trace).not.toBeNull();
  });
});

describe('Après résiliation', () => {
  it('le passeport se lit et s’exporte toujours — c’est pour dans dix ans', async () => {
    await ownerDb.souscriptionModule.update({
      where: { societeId_module: { societeId: CB, module: 'PASSEPORT' } },
      data: { statut: 'RESILIE', resilieLe: new Date() },
    });
    const lecture = await appel(`/operations/${operationId}/passeport`, { token: christophe });
    expect(lecture.status).toBe(200);
    const exp = await fetch(`${API}/operations/${operationId}/passeport/export`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(exp.status).toBe(200);
  });

  it('mais ne se modifie plus', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${operationId}/passeport/equipements`,
      {
        methode: 'POST',
        token: christophe,
        corps: { categorie: 'AUTRE', designation: 'Trop tard' },
      },
    );
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('résilié');
  });
});

describe('Isolation', () => {
  it('les équipements et le journal de l’IA ne traversent pas les sociétés', async () => {
    expect(await asTenant(CONSTRUCTA, (tx) => tx.equipement.count())).toBe(0);
    expect(await asTenant(CONSTRUCTA, (tx) => tx.appelIa.count())).toBe(0);
  });
});
