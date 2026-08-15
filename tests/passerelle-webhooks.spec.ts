/**
 * Lot 7 — Definition of Done :
 *   « une réservation Kolabimo apparaît dans Prometis ; un jalon terminé
 *     alimente la trésorerie Kolabimo ».
 *
 * Trois propriétés sont mises à l'épreuve ici, parce qu'aucune ne se voit à
 * l'œil nu :
 *
 *   · l'authentification d'un appel **machine** — clé + signature du corps ;
 *   · l'**idempotence** — un webhook rejoué ne crée rien de second ;
 *   · l'**étanchéité du journal**, qui n'est PAS tenue par la RLS ici :
 *     `webhook_events` ne porte pas de `societe_id`, le filtre est applicatif.
 *     C'est donc ce test, et lui seul, qui garantit qu'un tenant ne lit pas la
 *     synchronisation d'un autre.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CONSTRUCTA, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';
import { CLE_API_CONSTRUCTA, CLE_API_CB } from '../prisma/passerelle-cles-dev';
import { signer } from '../apps/api/src/passerelle/signature';

const PROMOTION_KOLABIMO = 4201;
/** Premier lot de l'Immeuble B — sans réservation dans le seed. */
const APPARTEMENT_KOLABIMO = 4312;
const EXTERNAL_ID = 'test-lot7-res-001';
const CLIENT_REF = 'test-lot7-cli-001';

let christophe: string;
let marc: string;
let bac = 0;
let etapeBac = 0;
let lotVise: { id: number; reference: string; prixVente: string; prixParking: string };

interface ReponseWebhook {
  recu: boolean;
  dejaTraite: boolean;
  statut: string;
  detail?: Record<string, unknown>;
}

/**
 * Envoie un webhook comme Kolabimo le ferait.
 *
 * Le corps est sérialisé **une fois** et c'est cette chaîne-là qui est signée
 * puis envoyée : signer un objet re-sérialisé ailleurs produirait une autre
 * empreinte, et le test échouerait pour la mauvaise raison.
 */
async function envoyerWebhook(
  corps: unknown,
  options: { cle?: string; signature?: string; horodatage?: Date } = {},
): Promise<{ status: number; body: ReponseWebhook }> {
  const cle = options.cle ?? CLE_API_CB;
  const corpsBrut = JSON.stringify(corps);
  const entetes: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cle) entetes['x-api-key'] = cle;
  entetes['x-kolabimo-signature'] =
    options.signature ?? signer(cle, corpsBrut, options.horodatage ?? new Date());

  const res = await fetch(`${API}/webhooks/kolabimo`, {
    method: 'POST',
    headers: entetes,
    body: corpsBrut,
  });
  const body = (await res.json().catch(() => null)) as ReponseWebhook;
  return { status: res.status, body };
}

/**
 * Charge de webhook par défaut, surchargeable champ par champ.
 *
 * `donnees` est extrait de la surcharge AVANT le reste : le laisser dans le
 * `...surcharge` final écraserait la fusion au lieu de la compléter — et tous
 * les appels partiraient avec une charge incomplète.
 */
function reservationKolabimo(
  surcharge: { donnees?: Record<string, unknown> } & Record<string, unknown> = {},
) {
  const { donnees: surchargeDonnees, ...enveloppe } = surcharge;
  return {
    evenement: 'reservation.created',
    idEvenement: 'test-lot7-evt-001',
    emisLe: new Date().toISOString(),
    ...enveloppe,
    donnees: {
      externalId: EXTERNAL_ID,
      reservationId: 9101,
      promotionId: PROMOTION_KOLABIMO,
      appartementId: APPARTEMENT_KOLABIMO,
      statut: 'reserve',
      dateReservation: '2026-08-01',
      client: {
        ref: CLIENT_REF,
        nom: 'Perrin',
        prenom: 'Camille',
        email: 'camille.perrin@example.ch',
      },
      ...surchargeDonnees,
    },
  };
}

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Lancer « npm run verifier ».`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  marc = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

  const lot = await ownerDb.lot.findFirstOrThrow({
    where: { kolabimoAppartementId: APPARTEMENT_KOLABIMO },
    select: { id: true, reference: true, prixVente: true, parkings: { select: { prix: true } } },
  });
  lotVise = {
    id: lot.id,
    reference: lot.reference,
    prixVente: lot.prixVente!.toFixed(2),
    prixParking: lot.parkings[0]!.prix!.toFixed(2),
  };
});

afterAll(async () => {
  // Toute suite qui écrit doit rendre le seed dans l'état où elle l'a trouvé.
  await ownerDb.reservation.deleteMany({ where: { externalId: EXTERNAL_ID } });
  await ownerDb.acquereur.deleteMany({ where: { kolabimoClientRef: CLIENT_REF } });
  await ownerDb.webhookEvent.deleteMany({ where: { dedupeKey: { contains: 'test-lot7' } } });
  if (bac) {
    await ownerDb.webhookEvent.deleteMany({ where: { dedupeKey: { contains: `:${bac}-` } } });
    await ownerDb.appelDeFonds.deleteMany({ where: { reservation: { operationId: bac } } });
    await ownerDb.reservation.deleteMany({ where: { operationId: bac } });
    await ownerDb.acquereur.deleteMany({ where: { kolabimoClientRef: 'test-lot7-cli-bac' } });
    await ownerDb.echeancierEtape.deleteMany({ where: { operationId: bac } });
    await ownerDb.auditLog.deleteMany({
      where: { donnees: { path: ['operationId'], equals: bac } },
    });
    await ownerDb.operationAccess.deleteMany({ where: { operationId: bac } });
    await ownerDb.bien.deleteMany({ where: { operationId: bac, lots: { none: {} } } });
    await supprimerOperationDeTest(bac);
  }
  await ownerDb.$disconnect();
});

// ---------------------------------------------------------------------
//  Authentification d'un appel machine
// ---------------------------------------------------------------------

describe('Le webhook refuse ce qu’il ne peut pas authentifier', () => {
  it('refuse une clé d’API inconnue', async () => {
    const res = await envoyerWebhook(reservationKolabimo(), {
      cle: 'pk_inconnue_0000000000000000',
    });
    expect(res.status).toBe(401);
  });

  it('refuse une signature qui ne correspond pas au corps', async () => {
    const res = await envoyerWebhook(reservationKolabimo(), {
      signature: signer(CLE_API_CB, '{"autre":"corps"}'),
    });
    expect(res.status).toBe(401);
  });

  it('refuse une signature périmée — la parade au rejeu réseau', async () => {
    const res = await envoyerWebhook(reservationKolabimo(), {
      horodatage: new Date(Date.now() - 3600_000),
    });
    expect(res.status).toBe(401);
  });

  it('n’enregistre rien au journal pour une requête non authentifiée', async () => {
    // Journaliser avant d'authentifier laisserait n'importe qui le remplir.
    const trace = await ownerDb.webhookEvent.count({
      where: { dedupeKey: { contains: 'test-lot7' } },
    });
    expect(trace).toBe(0);
  });
});

// ---------------------------------------------------------------------
//  Une réservation Kolabimo apparaît dans Prometis
// ---------------------------------------------------------------------

describe('Réconciliation d’une réservation', () => {
  it('crée la réservation, l’acquéreur, et calcule le prix total acte', async () => {
    const res = await envoyerWebhook(reservationKolabimo());
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.action).toBe('creee');

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID },
      include: { acquereur: true, lot: true },
    });
    expect(reservation.statut).toBe('RESERVE');
    expect(reservation.lot.reference).toBe(lotVise.reference);
    expect(reservation.kolabimoReservationId).toBe(9101);
    expect(reservation.acquereur.kolabimoClientRef).toBe(CLIENT_REF);

    // Prix total acte = prix du lot + Σ parkings, faute d'être fourni.
    const attendu = Number(lotVise.prixVente) + Number(lotVise.prixParking);
    expect(Number(reservation.prixTotalActe)).toBe(attendu);
  });

  it('rejoué à l’identique, ne crée rien de second', async () => {
    const res = await envoyerWebhook(reservationKolabimo());
    expect(res.status).toBe(200);
    expect(res.body.dejaTraite).toBe(true);

    const combien = await ownerDb.reservation.count({ where: { externalId: EXTERNAL_ID } });
    expect(combien).toBe(1);
    const acquereurs = await ownerDb.acquereur.count({ where: { kolabimoClientRef: CLIENT_REF } });
    expect(acquereurs).toBe(1);
  });

  it('applique un changement de statut sur la réservation existante', async () => {
    const res = await envoyerWebhook(
      reservationKolabimo({
        evenement: 'reservation.updated',
        idEvenement: 'test-lot7-evt-002',
        donnees: { statut: 'vendu', dateSignatureActe: '2026-08-10' },
      }),
    );
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.champs).toContain('statut');

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID },
    });
    expect(reservation.statut).toBe('VENDU');
    expect(reservation.dateSignatureActe).not.toBeNull();
  });

  it('refuse de bouger le prix une fois l’acte signé, et le dit', async () => {
    const res = await envoyerWebhook(
      reservationKolabimo({
        evenement: 'reservation.updated',
        idEvenement: 'test-lot7-evt-003',
        donnees: { statut: 'vendu', prixTotalActe: '999999' },
      }),
    );
    expect(res.body.statut).toBe('TRAITE');
    const refus = res.body.detail?.refus as { champ: string; raison: string }[];
    expect(refus.some((r) => r.champ === 'prixTotalActe')).toBe(true);

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID },
    });
    expect(Number(reservation.prixTotalActe)).not.toBe(999999);
  });

  it('ignore une promotion qu’on ne pilote pas, sans crier à l’erreur', async () => {
    const res = await envoyerWebhook(
      reservationKolabimo({
        idEvenement: 'test-lot7-evt-004',
        donnees: { promotionId: 999_999, externalId: 'test-lot7-res-hors-perimetre' },
      }),
    );
    expect(res.body.statut).toBe('IGNORE');
  });

  it('signale en erreur un appartement inconnu d’une promotion connue', async () => {
    const res = await envoyerWebhook(
      reservationKolabimo({
        idEvenement: 'test-lot7-evt-005',
        donnees: { appartementId: 999_999, externalId: 'test-lot7-res-lot-inconnu' },
      }),
    );
    expect(res.body.statut).toBe('ERREUR');
  });

  it('ignore un événement dont le type n’est pas pris en charge', async () => {
    const res = await envoyerWebhook({
      evenement: 'facture.emise',
      idEvenement: 'test-lot7-evt-006',
      donnees: {},
    });
    expect(res.body.statut).toBe('IGNORE');
  });
});

// ---------------------------------------------------------------------
//  Étanchéité du journal — la RLS ne protège pas cette table
// ---------------------------------------------------------------------

describe('Le journal de synchronisation reste dans son tenant', () => {
  it('CB Promotions voit ses propres événements', async () => {
    const res = await appel<{ id: number; evenement: string; dedupeKey: string }[]>(
      '/passerelle/journal?limite=200',
      { token: christophe },
    );
    expect(res.ok).toBe(true);
    expect(res.body.some((e) => e.dedupeKey.includes('test-lot7'))).toBe(true);
  });

  it('Constructa n’en voit aucun', async () => {
    const res = await appel<{ dedupeKey: string }[]>('/passerelle/journal?limite=200', {
      token: marc,
    });
    expect(res.ok).toBe(true);
    expect(res.body.some((e) => e.dedupeKey.includes('test-lot7'))).toBe(false);
  });

  it('une clé Kolabimo d’un autre tenant ne touche pas la promotion de CB Promotions', async () => {
    // Même promotion, même appartement, mais signé par Constructa : chez lui,
    // aucune opération ne porte ce kolabimoPromotionId — donc hors périmètre.
    const res = await envoyerWebhook(
      reservationKolabimo({
        idEvenement: 'test-lot7-evt-intrusion',
        donnees: { externalId: 'test-lot7-res-intrusion' },
      }),
      { cle: CLE_API_CONSTRUCTA },
    );
    expect(res.body.statut).toBe('IGNORE');

    const intruse = await ownerDb.reservation.count({
      where: { externalId: 'test-lot7-res-intrusion' },
    });
    expect(intruse).toBe(0);
  });
});

// ---------------------------------------------------------------------
//  Boîte d'envoi — un jalon terminé part vers Kolabimo
// ---------------------------------------------------------------------

describe('Émission vers Kolabimo', () => {
  beforeAll(async () => {
    const creation = await appel<{ id: number }>('/operations', {
      methode: 'POST',
      token: christophe,
      corps: {
        nom: 'Bac à sable passerelle — test',
        commune: 'Prilly',
        commercialisationActive: true,
      },
    });
    bac = creation.body.id;

    const bien = await appel<{ id: number }>(`/operations/${bac}/biens`, {
      methode: 'POST',
      token: christophe,
      corps: { nature: 'IMMEUBLE', nom: 'Immeuble passerelle' },
    });
    const lot = await appel<{ id: number }>(`/operations/${bac}/biens/${bien.body.id}/lots`, {
      methode: 'POST',
      token: christophe,
      corps: { reference: 'K01', prixVente: '800000' },
    });
    const acquereur = await appel<{ id: number }>('/acquereurs', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Passerelle', prenom: 'Test', email: 'passerelle@example.ch' },
    });
    await ownerDb.acquereur.update({
      where: { id: acquereur.body.id },
      data: { kolabimoClientRef: 'test-lot7-cli-bac' },
    });
    await appel(`/operations/${bac}/reservations`, {
      methode: 'POST',
      token: christophe,
      corps: {
        lotId: lot.body.id,
        acquereurId: acquereur.body.id,
        statut: 'RESERVE',
        externalId: 'test-lot7-res-bac',
      },
    });
    const etape = await appel<{ id: number }>(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 1, libelle: 'Signature de l’acte', pourcentage: '10' },
    });
    etapeBac = etape.body.id;
  });

  it('dépose un événement sortant quand un jalon est clos, même sans Kolabimo joignable', async () => {
    const res = await appel<{ appelsCrees: number; synchronisation: { livre: boolean } }>(
      `/operations/${bac}/echeancier/${etapeBac}/declencher`,
      { methode: 'POST', token: christophe, corps: { envoyer: false } },
    );
    expect(res.ok).toBe(true);
    expect(res.body.appelsCrees).toBe(1);
    // La passerelle n'est pas configurée en développement : la livraison
    // échoue, et c'est exactement le comportement attendu — l'événement reste
    // en boîte d'envoi, le jalon est clos quand même.
    expect(res.body.synchronisation.livre).toBe(false);

    const sortants = await ownerDb.webhookEvent.findMany({
      where: { dedupeKey: `prometis:echeancier.etape_completed:${bac}-${etapeBac}` },
    });
    expect(sortants).toHaveLength(1);
    expect(sortants[0]!.statut).toBe('ERREUR');
    expect(sortants[0]!.erreur).toContain('non configurée');

    const charge = sortants[0]!.payload as { donnees: { appelsDeFonds: unknown[] } };
    expect(charge.donnees.appelsDeFonds).toHaveLength(1);
  });

  it('rejouer le déclenchement ne produit pas un second message sortant', async () => {
    await appel(`/operations/${bac}/echeancier/${etapeBac}/declencher`, {
      methode: 'POST',
      token: christophe,
      corps: { envoyer: false },
    });
    const sortants = await ownerDb.webhookEvent.count({
      where: { dedupeKey: `prometis:echeancier.etape_completed:${bac}-${etapeBac}` },
    });
    expect(sortants).toBe(1);
  });

  it('le journal expose l’événement sortant et permet de le rejouer', async () => {
    const journal = await appel<{ id: number; source: string; dedupeKey: string }[]>(
      '/passerelle/journal?source=prometis&limite=200',
      { token: christophe },
    );
    const sortant = journal.body.find((e) => e.dedupeKey.includes(`:${bac}-${etapeBac}`));
    expect(sortant).toBeDefined();

    const rejeu = await appel<{ sens: string; livre: boolean; raison?: string }>(
      `/passerelle/journal/${sortant!.id}/rejouer`,
      { methode: 'POST', token: christophe },
    );
    expect(rejeu.body.sens).toBe('sortant');
    expect(rejeu.body.livre).toBe(false);
    expect(rejeu.body.raison).toContain('non configurée');
  });

  it('l’état de la passerelle dit qu’elle n’est pas configurée, sans divulguer la clé', async () => {
    const res = await appel<{
      sortant: { configure: boolean };
      clesEntrantes: { label: string | null; key?: string }[];
    }>('/passerelle/etat', { token: christophe });
    expect(res.body.sortant.configure).toBe(false);
    expect(res.body.clesEntrantes.length).toBeGreaterThan(0);
    // La clé sert aussi de secret de signature : elle ne ressort jamais.
    expect(res.body.clesEntrantes[0]!.key).toBeUndefined();
  });
});
