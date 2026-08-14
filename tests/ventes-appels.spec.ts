/**
 * Lot 6 — Definition of Done :
 *   « marquer un jalon terminé génère et envoie les appels de fonds ;
 *     idempotent ».
 *
 * Le parcours se déroule dans un bac à sable complet — opération, lots,
 * acquéreurs, échéancier — pour ne rien devoir aux données du seed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, PROBAT, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let operationSeed: number;
let bac: number;

/** Lots, acquéreurs et étapes du bac à sable. */
const contexte = {
  lotA: 0,
  lotB: 0,
  acquereurA: 0,
  acquereurB: 0,
  etapeAppelante: 0,
  etapeSuivi: 0,
  reservationEngagee: 0,
  reservationOption: 0,
};

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Démarrer « npm run dev:api » puis relancer.`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, PROBAT);

  const operations = await appel<{ id: number; nom: string }[]>('/operations', {
    token: christophe,
  });
  operationSeed = operations.body.find((o) => o.nom === 'Les Jardins de Prilly')!.id;

  const creation = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable ventes — test', commune: 'Prilly', commercialisationActive: true },
  });
  bac = creation.body.id;

  const bien = await appel<{ id: number }>(`/operations/${bac}/biens`, {
    methode: 'POST',
    token: christophe,
    corps: { nature: 'IMMEUBLE', nom: 'Immeuble test' },
  });

  // Lot A : 800 000 + box 50 000 = 850 000, comme le lot de référence.
  const lotA = await appel<{ id: number }>(`/operations/${bac}/biens/${bien.body.id}/lots`, {
    methode: 'POST',
    token: christophe,
    corps: { reference: 'T01', prixVente: '800000' },
  });
  contexte.lotA = lotA.body.id;
  await appel(`/operations/${bac}/lots/${contexte.lotA}/parkings`, {
    methode: 'POST',
    token: christophe,
    corps: { type: 'BOX', prix: '50000' },
  });

  const lotB = await appel<{ id: number }>(`/operations/${bac}/biens/${bien.body.id}/lots`, {
    methode: 'POST',
    token: christophe,
    corps: { reference: 'T02', prixVente: '600000' },
  });
  contexte.lotB = lotB.body.id;

  const a = await appel<{ id: number }>('/acquereurs', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Testard', prenom: 'Alice', email: 'alice.testard@example.ch' },
  });
  contexte.acquereurA = a.body.id;

  const b = await appel<{ id: number }>('/acquereurs', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Optionnaire', prenom: 'Bob', email: 'bob@example.ch' },
  });
  contexte.acquereurB = b.body.id;
});

afterAll(async () => {
  if (bac) {
    // Les acquéreurs créés ne sont rattachés qu'à ce bac : ils partent avec.
    await ownerDb.encaissement.deleteMany({
      where: { appelDeFonds: { reservation: { operationId: bac } } },
    });
    await ownerDb.appelDeFonds.deleteMany({ where: { reservation: { operationId: bac } } });
    await ownerDb.reservation.deleteMany({ where: { operationId: bac } });
    await ownerDb.acquereur.deleteMany({
      where: { id: { in: [contexte.acquereurA, contexte.acquereurB] } },
    });
    await supprimerOperationDeTest(bac);
  }
  await ownerDb.$disconnect();
});

// =====================================================================

describe('réservations et prix total acte', () => {
  it('fige le prix total acte : prix du lot + parkings', async () => {
    const res = await appel<{ id: number; prixTotalActe: string }>(
      `/operations/${bac}/reservations`,
      {
        methode: 'POST',
        token: christophe,
        corps: {
          lotId: contexte.lotA,
          acquereurId: contexte.acquereurA,
          statut: 'VENDU',
          dateSignatureActe: '2026-05-01',
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.prixTotalActe).toBe('850000'); // 800 000 + 50 000
    contexte.reservationEngagee = res.body.id;
  });

  it('refuse une seconde réservation active sur le même lot', async () => {
    const res = await appel<{ message: string }>(`/operations/${bac}/reservations`, {
      methode: 'POST',
      token: christophe,
      corps: { lotId: contexte.lotA, acquereurId: contexte.acquereurB, statut: 'OPTION' },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('déjà une réservation');
  });

  it("refuse de changer le prix total acte quand l'acte est signé", async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bac}/reservations/${contexte.reservationEngagee}`,
      { methode: 'PATCH', token: christophe, corps: { prixTotalActe: '900000' } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('figé');
  });

  it('bascule le statut du lot avec celui de la réservation', async () => {
    const reservations = await appel<{ lot: { id: number } }[]>(`/operations/${bac}/reservations`, {
      token: christophe,
    });
    const lot = await ownerDb.lot.findUniqueOrThrow({ where: { id: contexte.lotA } });
    expect(reservations.body).toHaveLength(1);
    expect(lot.statut).toBe('VENDU');
  });

  it('crée une simple option sur le second lot', async () => {
    const res = await appel<{ id: number; prixTotalActe: string }>(
      `/operations/${bac}/reservations`,
      {
        methode: 'POST',
        token: christophe,
        corps: { lotId: contexte.lotB, acquereurId: contexte.acquereurB, statut: 'OPTION' },
      },
    );
    expect(res.body.prixTotalActe).toBe('600000');
    contexte.reservationOption = res.body.id;
  });
});

// =====================================================================

describe('échéancier', () => {
  it('contrôle la somme des pourcentages et la chiffre', async () => {
    await appel(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 1, libelle: "Signature de l'acte", pourcentage: '30.00' },
    });

    const partiel = await appel<{ controle: { complet: boolean; ecart: string } }>(
      `/operations/${bac}/echeancier`,
      { token: christophe },
    );
    expect(partiel.body.controle.complet).toBe(false);
    // Les 70 % manquants ne seraient jamais appelés.
    expect(partiel.body.controle.ecart).toBe('-70');
  });

  it('accepte un jalon de suivi sans pourcentage', async () => {
    const etape = await appel<{ id: number; pourcentage: string | null }>(
      `/operations/${bac}/echeancier`,
      {
        methode: 'POST',
        token: christophe,
        corps: { ordre: 2, libelle: "Réception de l'ouvrage", pourcentage: null },
      },
    );
    expect(etape.body.pourcentage).toBeNull();
    contexte.etapeSuivi = etape.body.id;
  });

  it('complète l’échéancier à 100 %', async () => {
    const etape = await appel<{ id: number }>(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 3, libelle: 'Gros œuvre', pourcentage: '70.00' },
    });
    contexte.etapeAppelante = etape.body.id;

    const complet = await appel<{ controle: { complet: boolean; nombreJalonsSuivi: number } }>(
      `/operations/${bac}/echeancier`,
      { token: christophe },
    );
    expect(complet.body.controle.complet).toBe(true);
    expect(complet.body.controle.nombreJalonsSuivi).toBe(1);
  });

  it('refuse deux étapes au même ordre', async () => {
    const res = await appel<{ message: string }>(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 1, libelle: 'Doublon', pourcentage: '0.00' },
    });
    expect(res.status).toBe(400);
  });
});

// =====================================================================

describe('DoD — un jalon terminé génère et envoie les appels de fonds', () => {
  it('un jalon de suivi ne génère aucun appel', async () => {
    const res = await appel<{ jalonDeSuivi: boolean; appelsCrees: number }>(
      `/operations/${bac}/echeancier/${contexte.etapeSuivi}/declencher`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(200);
    expect(res.body.jalonDeSuivi).toBe(true);
    expect(res.body.appelsCrees).toBe(0);
  });

  it('génère un appel par réservation ENGAGÉE, et envoie', async () => {
    const res = await appel<{
      appelsCrees: number;
      montantTotal: string;
      envois: { reussis: number; echecs: unknown[] };
    }>(`/operations/${bac}/echeancier/${contexte.etapeAppelante}/declencher`, {
      methode: 'POST',
      token: christophe,
      corps: { dateCompletion: '2026-11-28' },
    });

    expect(res.status).toBe(200);
    // Un seul appel : l'option de Bob n'est pas un engagement.
    expect(res.body.appelsCrees).toBe(1);
    expect(res.body.montantTotal).toBe('595000.00'); // 70 % de 850 000
    expect(res.body.envois.reussis).toBe(1);
    expect(res.body.envois.echecs).toHaveLength(0);
  });

  it('DoD — rejouer ne crée rien', async () => {
    const res = await appel<{ appelsCrees: number; appelsDejaExistants: number }>(
      `/operations/${bac}/echeancier/${contexte.etapeAppelante}/declencher`,
      { methode: 'POST', token: christophe, corps: { dateCompletion: '2026-11-28' } },
    );
    expect(res.body.appelsCrees).toBe(0);
    expect(res.body.appelsDejaExistants).toBe(1);

    const appels = await appel<unknown[]>(`/operations/${bac}/appels-de-fonds`, {
      token: christophe,
    });
    expect(appels.body).toHaveLength(1);
  });

  it("l'appel porte une référence QR valide et un numéro lisible", async () => {
    const appels = await appel<
      { numero: string; qrReference: string; statut: string; montant: string }[]
    >(`/operations/${bac}/appels-de-fonds`, { token: christophe });
    const a = appels.body[0]!;

    expect(a.numero).toMatch(/^AF-2026-\d{4}$/);
    expect(a.qrReference).toHaveLength(27);
    expect(a.statut).toBe('ENVOYE');
    expect(a.montant).toBe('595000');
  });

  it("l'option de Bob n'a reçu aucun appel", async () => {
    const appels = await appel<{ reservation: { id: number } }[]>(
      `/operations/${bac}/appels-de-fonds`,
      { token: christophe },
    );
    expect(appels.body.map((a) => a.reservation.id)).not.toContain(contexte.reservationOption);
  });

  it("l'étape passe à COMPLETED avec sa date", async () => {
    const echeancier = await appel<{
      etapes: { id: number; statut: string; dateCompletion: string | null }[];
    }>(`/operations/${bac}/echeancier`, { token: christophe });
    const etape = echeancier.body.etapes.find((e) => e.id === contexte.etapeAppelante)!;
    expect(etape.statut).toBe('COMPLETED');
    expect(etape.dateCompletion!.slice(0, 10)).toBe('2026-11-28');
  });

  it('le pourcentage se fige dès qu’un appel en découle', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bac}/echeancier/${contexte.etapeAppelante}`,
      { methode: 'PATCH', token: christophe, corps: { pourcentage: '80.00' } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ne peut plus être modifié');
  });
});

// =====================================================================

describe('encaissements et relances', () => {
  let appelId: number;

  it('un encaissement partiel laisse le solde ouvert', async () => {
    const appels = await appel<{ id: number }[]>(`/operations/${bac}/appels-de-fonds`, {
      token: christophe,
    });
    appelId = appels.body[0]!.id;

    const res = await appel<{ etat: { partiellementPaye: boolean; solde: string } }>(
      `/operations/${bac}/appels-de-fonds/${appelId}/encaissements`,
      {
        methode: 'POST',
        token: christophe,
        corps: { montant: '200000', dateValeur: '2026-12-05', source: 'camt.054' },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.etat.partiellementPaye).toBe(true);
    expect(res.body.etat.solde).toBe('395000');
  });

  it('le solde suivant marque l’appel payé', async () => {
    const res = await appel<{ etat: { soldé: boolean } }>(
      `/operations/${bac}/appels-de-fonds/${appelId}/encaissements`,
      {
        methode: 'POST',
        token: christophe,
        corps: { montant: '395000', dateValeur: '2026-12-20' },
      },
    );
    expect(res.body.etat.soldé).toBe(true);

    const appels = await appel<{ statut: string }[]>(`/operations/${bac}/appels-de-fonds`, {
      token: christophe,
    });
    expect(appels.body[0]!.statut).toBe('PAYE');
  });

  it('un appel soldé ne se relance pas', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bac}/appels-de-fonds/${appelId}/relance`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('soldé');
  });
});

// =====================================================================

describe('cohérence avec le seed et les droits', () => {
  it('le lot A02 du prototype garde son assiette de 850 000', async () => {
    const reservations = await appel<
      { lot: { reference: string }; prixTotalActe: string; appelsDeFonds: { montant: string }[] }[]
    >(`/operations/${operationSeed}/reservations`, { token: christophe });

    const a02 = reservations.body.find((r) => r.lot.reference === 'A02')!;
    expect(a02.prixTotalActe).toBe('850000');
    // 5 % = 42 500 et 15 % = 127 500, comme le prototype.
    expect(a02.appelsDeFonds.map((a) => a.montant).sort()).toEqual(['127500', '42500']);
  });

  it("une entreprise générale n'a pas d'appels de fonds — le module n'est pas activé", async () => {
    const marc = await jetonPourEspace(COMPTES.marc, 2);
    const operations = await appel<{ id: number }[]>('/operations', { token: marc });
    const res = await appel<{ message: string }>(
      `/operations/${operations.body[0]!.id}/appels-de-fonds`,
      { token: marc },
    );
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('APPELS_FONDS');
  });

  it("l'intervenant externe de Probat n'y accède pas non plus", async () => {
    const marc = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel(`/operations/${operationSeed}/appels-de-fonds`, { token: marc });
    expect(res.status).toBe(403);
  });
});
