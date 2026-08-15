/**
 * Lot 8 — Definition of Done : « chaque écran restant du prototype est
 * fonctionnel ».
 *
 * Le parcours se déroule dans un bac à sable complet, puis efface ce qu'il a
 * créé — y compris les fichiers déposés sur le disque, sans quoi chaque
 * exécution laisserait des pièces derrière elle.
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let bac = 0;
let operationSeed = 0;

const contexte = {
  lotId: 0,
  lotSeedId: 0,
  acquereurId: 0,
  reservationId: 0,
  reservationOptionId: 0,
  courtierId: 0,
  documentId: 0,
  seanceId: 0,
  mandatId: 0,
};

/** Dépôt multipart — l'API attend un champ `fichier` et des champs texte. */
async function deposerFichier(
  chemin: string,
  fichier: { nom: string; type: string; contenu: string },
  champs: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const formulaire = new FormData();
  formulaire.append('fichier', new Blob([fichier.contenu], { type: fichier.type }), fichier.nom);
  for (const [cle, valeur] of Object.entries(champs)) formulaire.append(cle, valeur);

  const res = await fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${christophe}` },
    body: formulaire,
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Lancer « npm run verifier ».`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, CB);

  const operations = await appel<{ id: number; nom: string }[]>('/operations', {
    token: christophe,
  });
  operationSeed = operations.body.find((o) => o.nom === 'Les Jardins de Prilly')!.id;
  const lotSeed = await ownerDb.lot.findFirstOrThrow({
    where: { bien: { operationId: operationSeed } },
    select: { id: true },
  });
  contexte.lotSeedId = lotSeed.id;

  const creation = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable annexes — test', commune: 'Prilly', commercialisationActive: true },
  });
  bac = creation.body.id;

  const bien = await appel<{ id: number }>(`/operations/${bac}/biens`, {
    methode: 'POST',
    token: christophe,
    corps: { nature: 'IMMEUBLE', nom: 'Immeuble annexes' },
  });
  const lot = await appel<{ id: number }>(`/operations/${bac}/biens/${bien.body.id}/lots`, {
    methode: 'POST',
    token: christophe,
    corps: { reference: 'X01', prixVente: '850000' },
  });
  contexte.lotId = lot.body.id;

  const acquereur = await appel<{ id: number }>('/acquereurs', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Annexe', prenom: 'Test', email: 'annexes@example.ch' },
  });
  contexte.acquereurId = acquereur.body.id;

  const reservation = await appel<{ id: number }>(`/operations/${bac}/reservations`, {
    methode: 'POST',
    token: christophe,
    corps: { lotId: contexte.lotId, acquereurId: contexte.acquereurId, statut: 'RESERVE' },
  });
  contexte.reservationId = reservation.body.id;

  const courtier = await appel<{ id: number }>('/acteurs', {
    methode: 'POST',
    token: christophe,
    corps: { type: 'COURTIER', societeNom: 'Régie du Test SA', email: 'courtier@example.ch' },
  });
  contexte.courtierId = courtier.body.id;
});

afterAll(async () => {
  if (bac) {
    await ownerDb.commissionCourtage.deleteMany({
      where: { mandatCourtage: { operationId: bac } },
    });
    await ownerDb.mandatCourtageLot.deleteMany({
      where: { mandatCourtage: { operationId: bac } },
    });
    await ownerDb.mandatCourtage.deleteMany({ where: { operationId: bac } });
    await ownerDb.document.deleteMany({ where: { operationId: bac } });
    await ownerDb.seancePoint.deleteMany({ where: { seance: { operationId: bac } } });
    await ownerDb.seanceParticipant.deleteMany({ where: { seance: { operationId: bac } } });
    await ownerDb.seance.deleteMany({ where: { operationId: bac } });
    await ownerDb.reservation.deleteMany({ where: { operationId: bac } });
    await ownerDb.acquereur.deleteMany({ where: { id: contexte.acquereurId } });
    await ownerDb.operationActeur.deleteMany({ where: { operationId: bac } });
    await ownerDb.acteur.deleteMany({ where: { id: contexte.courtierId } });
    await ownerDb.auditLog.deleteMany({
      where: { donnees: { path: ['operationId'], equals: bac } },
    });
    await ownerDb.operationAccess.deleteMany({ where: { operationId: bac } });
    await ownerDb.bien.deleteMany({ where: { operationId: bac, lots: { none: {} } } });
    await supprimerOperationDeTest(bac);

    // Les pièces déposées vivent hors base : sans ce nettoyage, chaque
    // exécution en laisserait une poignée sur le disque.
    await rm(
      resolve(process.env.STOCKAGE_LOCAL_DIR ?? './var/documents', `societes/1/operations/${bac}`),
      {
        recursive: true,
        force: true,
      },
    );
  }
  await ownerDb.$disconnect();
});

// ---------------------------------------------------------------------
//  GED
// ---------------------------------------------------------------------

describe('GED — dépôt, versions et téléchargement', () => {
  it('dépose un document et le rend courant en version 1', async () => {
    const res = await deposerFichier(
      `/operations/${bac}/documents`,
      { nom: 'Plan RDC.pdf', type: 'application/pdf', contenu: 'PLAN-VERSION-1' },
      { titre: 'Plan du rez', categorie: 'PLAN', lotId: String(contexte.lotId) },
    );
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
    expect(res.body.isCourant).toBe(true);
    contexte.documentId = res.body.id as number;

    // Le nom d'origine est conservé pour l'affichage ; le chemin de stockage,
    // lui, est assaini et préfixé par la société.
    expect(res.body.fileName).toBe('Plan RDC.pdf');
    expect(String(res.body.filePath)).toContain(`societes/1/operations/${bac}/`);
  });

  it('rend le contenu exact, en pièce jointe', async () => {
    const res = await fetch(`${API}/operations/${bac}/documents/${contexte.documentId}/contenu`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(await res.text()).toBe('PLAN-VERSION-1');
  });

  it('dépose une version 2 sans effacer la version 1', async () => {
    const res = await deposerFichier(
      `/operations/${bac}/documents/${contexte.documentId}/versions`,
      { nom: 'Plan RDC v2.pdf', type: 'application/pdf', contenu: 'PLAN-VERSION-2' },
    );
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);

    const versions = await appel<{ version: number; isCourant: boolean }[]>(
      `/operations/${bac}/documents/${contexte.documentId}/versions`,
      { token: christophe },
    );
    expect(versions.body).toHaveLength(2);
    expect(versions.body.find((v) => v.version === 1)!.isCourant).toBe(false);
    expect(versions.body.find((v) => v.version === 2)!.isCourant).toBe(true);
  });

  it('ne liste que la version courante par défaut', async () => {
    const courantes = await appel<{ id: number }[]>(`/operations/${bac}/documents`, {
      token: christophe,
    });
    const toutes = await appel<{ id: number }[]>(
      `/operations/${bac}/documents?toutesVersions=true`,
      { token: christophe },
    );
    expect(toutes.body.length).toBeGreaterThan(courantes.body.length);
  });

  it('refuse un rattachement à un lot d’une autre opération', async () => {
    // La RLS garantit le bon tenant, pas la bonne opération : sans ce
    // contrôle, la pièce apparaîtrait dans le dossier de quelqu'un d'autre.
    const res = await deposerFichier(
      `/operations/${bac}/documents`,
      { nom: 'intrus.pdf', type: 'application/pdf', contenu: 'x' },
      { titre: 'Intrus', lotId: String(contexte.lotSeedId) },
    );
    expect(res.status).toBe(404);
  });

  it('refuse de supprimer un document qui porte des versions', async () => {
    const res = await appel(`/operations/${bac}/documents/${contexte.documentId}`, {
      methode: 'DELETE',
      token: christophe,
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------
//  Séances et PV
// ---------------------------------------------------------------------

describe('Séances, points et procès-verbal', () => {
  it('crée une séance avec participants et points', async () => {
    const seance = await appel<{ id: number }>(`/operations/${bac}/seances`, {
      methode: 'POST',
      token: christophe,
      corps: {
        titre: 'Séance de chantier',
        numero: 'Chantier #1',
        type: 'CHANTIER',
        date: '2026-08-12',
        lieu: 'Prilly',
      },
    });
    contexte.seanceId = seance.body.id;

    await appel(`/operations/${bac}/seances/${contexte.seanceId}/participants`, {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Julie Renaud', organisation: 'CB Promotions', present: true },
    });
    await appel(`/operations/${bac}/seances/${contexte.seanceId}/participants`, {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Marc Girard', organisation: 'Constructa', present: false },
    });

    const point = await appel<{ id: number; ordre: number }>(
      `/operations/${bac}/seances/${contexte.seanceId}/points`,
      {
        methode: 'POST',
        token: christophe,
        corps: {
          titre: 'Étanchéité toiture',
          contenu: 'Reprise à faire avant la pose.',
          responsable: 'Currat SA',
          echeance: '2026-08-01',
        },
      },
    );
    // Sans numéro fourni, le point prend la suite.
    expect(point.body.ordre).toBe(1);

    const detail = await appel<{ points: { enRetard: boolean }[] }>(
      `/operations/${bac}/seances/${contexte.seanceId}`,
      { token: christophe },
    );
    expect(detail.body.points[0]!.enRetard).toBe(true);
  });

  it('refuse de tenir une séance sans date', async () => {
    const sansDate = await appel<{ id: number }>(`/operations/${bac}/seances`, {
      methode: 'POST',
      token: christophe,
      corps: { titre: 'Séance sans date' },
    });
    const res = await appel(`/operations/${bac}/seances/${sansDate.body.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { statut: 'TENUE' },
    });
    expect(res.status).toBe(400);
  });

  it('génère le PV et le dépose en GED', async () => {
    const res = await appel<{
      document: { id: number; categorie: string; version: number };
      texte: string;
    }>(`/operations/${bac}/seances/${contexte.seanceId}/pv`, {
      methode: 'POST',
      token: christophe,
    });
    expect(res.ok).toBe(true);
    expect(res.body.document.categorie).toBe('PV_SEANCE');
    expect(res.body.document.version).toBe(1);
    expect(res.body.texte).toContain('Étanchéité toiture');
    expect(res.body.texte).toContain('## Points restant ouverts');
    expect(res.body.texte).toContain('- Julie Renaud (CB Promotions)');
  });

  it('regénéré, il produit une version, jamais un second document', async () => {
    const res = await appel<{ document: { version: number } }>(
      `/operations/${bac}/seances/${contexte.seanceId}/pv`,
      { methode: 'POST', token: christophe },
    );
    expect(res.body.document.version).toBe(2);

    const pv = await ownerDb.document.findMany({
      where: { seanceId: contexte.seanceId, parentDocumentId: null },
    });
    expect(pv).toHaveLength(1);
  });

  it('récapitule les actions ouvertes de toute l’opération', async () => {
    const res = await appel<{ total: number; enRetard: number; sansEcheance: number }>(
      `/operations/${bac}/seances/actions`,
      { token: christophe },
    );
    expect(res.body.total).toBe(1);
    expect(res.body.enRetard).toBe(1);
  });
});

// ---------------------------------------------------------------------
//  Courtage
// ---------------------------------------------------------------------

describe('Mandats de courtage et commissions', () => {
  it('crée un mandat exclusif sur toute l’opération', async () => {
    const res = await appel<{ id: number }>(`/operations/${bac}/courtage/mandats`, {
      methode: 'POST',
      token: christophe,
      corps: {
        courtierActeurId: contexte.courtierId,
        commissionType: 'POURCENTAGE',
        commissionPct: '3',
        exclusif: true,
        dateSignature: '2026-07-01',
      },
    });
    expect(res.ok).toBe(true);
    contexte.mandatId = res.body.id;

    await appel(`/operations/${bac}/courtage/mandats/${contexte.mandatId}/statut`, {
      methode: 'PATCH',
      token: christophe,
      corps: { statut: 'ACTIF' },
    });
  });

  it('refuse un second mandat exclusif sur les mêmes lots', async () => {
    const res = await appel<{ message?: string }>(`/operations/${bac}/courtage/mandats`, {
      methode: 'POST',
      token: christophe,
      corps: {
        courtierActeurId: contexte.courtierId,
        commissionPct: '2',
        exclusif: true,
        perimetre: 'LOTS_SELECTIONNES',
        lotIds: [contexte.lotId],
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('xclusivité');
  });

  it('refuse un périmètre « lots sélectionnés » sans lot', async () => {
    const res = await appel(`/operations/${bac}/courtage/mandats`, {
      methode: 'POST',
      token: christophe,
      corps: {
        courtierActeurId: contexte.courtierId,
        commissionPct: '2',
        perimetre: 'LOTS_SELECTIONNES',
        lotIds: [],
      },
    });
    expect(res.status).toBe(400);
  });

  it('constate la commission due sur la vente', async () => {
    const res = await appel<{ creees: { montant: string; motif: string }[] }>(
      `/operations/${bac}/courtage/reservations/${contexte.reservationId}/commissions`,
      { methode: 'POST', token: christophe },
    );
    expect(res.ok).toBe(true);
    expect(res.body.creees).toHaveLength(1);
    // 3 % de 850 000 (prix du lot, sans parking) = 25 500.
    expect(res.body.creees[0]!.montant).toBe('25500.00');
    expect(res.body.creees[0]!.motif).toContain('hors taxe');
  });

  it('rejoué, ne constate pas une seconde fois', async () => {
    const res = await appel<{ creees: unknown[]; ignores: { raison: string }[] }>(
      `/operations/${bac}/courtage/reservations/${contexte.reservationId}/commissions`,
      { methode: 'POST', token: christophe },
    );
    expect(res.body.creees).toHaveLength(0);
    expect(res.body.ignores).toHaveLength(1);

    const commissions = await ownerDb.commissionCourtage.count({
      where: { reservationId: contexte.reservationId },
    });
    expect(commissions).toBe(1);
  });

  it('refuse de constater une commission sur une simple option', async () => {
    // Une option n'est pas une vente : la commission serait à annuler dès que
    // l'acquéreur renonce.
    const bienId = await ownerDb.bien.findFirstOrThrow({
      where: { operationId: bac },
      select: { id: true },
    });
    const lot = await appel<{ id: number }>(`/operations/${bac}/biens/${bienId.id}/lots`, {
      methode: 'POST',
      token: christophe,
      corps: { reference: 'X02', prixVente: '600000' },
    });
    const option = await appel<{ id: number }>(`/operations/${bac}/reservations`, {
      methode: 'POST',
      token: christophe,
      corps: { lotId: lot.body.id, acquereurId: contexte.acquereurId, statut: 'OPTION' },
    });
    contexte.reservationOptionId = option.body.id;

    const res = await appel(
      `/operations/${bac}/courtage/reservations/${contexte.reservationOptionId}/commissions`,
      { methode: 'POST', token: christophe },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------
//  Trésorerie
// ---------------------------------------------------------------------

describe('Trésorerie consolidée', () => {
  it('rend une situation cohérente sur une opération sans mouvement', async () => {
    const res = await appel<{
      position: string;
      mois: unknown[];
      attendu: { creancesAcquereurs: string };
    }>(`/operations/${bac}/tresorerie`, { token: christophe });

    expect(res.ok).toBe(true);
    expect(res.body.position).toBe('0.00');
    expect(res.body.mois).toHaveLength(0);
    expect(res.body.attendu.creancesAcquereurs).toBe('0.00');
  });

  it('sur l’opération du seed, encaissements et paiements se répondent', async () => {
    const res = await appel<{
      totalEncaisse: string;
      totalDecaisse: string;
      position: string;
      engagements: { commandeHt: string; factureHt: string; resteAFacturerHt: string };
      mois: { mois: string; cumul: string }[];
    }>(`/operations/${operationSeed}/tresorerie`, { token: christophe });

    expect(res.ok).toBe(true);
    // Le seed porte une facture payée : le décaissé n'est donc pas nul, et la
    // position est nécessairement la somme des mouvements.
    expect(Number(res.body.totalDecaisse)).toBeGreaterThan(0);
    expect(Number(res.body.position)).toBe(
      Number(res.body.totalEncaisse) - Number(res.body.totalDecaisse),
    );
    // Le contrat de plâtrerie est adjugé à 372 500 : il reste à facturer la
    // différence avec ce qui est déjà validé.
    expect(Number(res.body.engagements.commandeHt)).toBeGreaterThan(0);
    expect(Number(res.body.engagements.resteAFacturerHt)).toBe(
      Number(res.body.engagements.commandeHt) - Number(res.body.engagements.factureHt),
    );
    // Le dernier mois porte la position finale.
    expect(res.body.mois[res.body.mois.length - 1]!.cumul).toBe(res.body.position);
  });
});
