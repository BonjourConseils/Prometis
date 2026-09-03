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
import { empreinteNue, signer } from '../apps/api/src/passerelle/signature';

const PROMOTION_KOLABIMO = 4201;
/** Premier lot de l'Immeuble B — sans réservation dans le seed. */
const APPARTEMENT_KOLABIMO = 4312;
/** Deuxième lot libre de l'Immeuble B — sert au dossier à plusieurs personnes. */
const APPARTEMENT_DOSSIER = 4313;
const EXTERNAL_ID_DOSSIER = 'test-lot7-res-dossier';
const CLIENT_REF_DOSSIER = 'test-lot7-cli-dossier';
const EXTERNAL_ID = 'test-lot7-res-001';
const CLIENT_REF = 'test-lot7-cli-001';

/** Promotion Kolabimo du bac à sable — sert à éprouver la garde « Kolabimo est maître ». */
const PROMOTION_BAC = 99_201;

let christophe: string;
let marc: string;
let bac = 0;
let lotBac = 0;
let reservationBac = 0;
let etapeBac = 0;
let etapeBacDeux = 0;
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
  options: {
    cle?: string;
    signature?: string;
    horodatage?: Date;
    /** Nom de l'événement à poser en en-tête : bascule sur le contrat Kolabimo. */
    contratKolabimo?: string;
    livraison?: string;
  } = {},
): Promise<{ status: number; body: ReponseWebhook }> {
  const cle = options.cle ?? CLE_API_CB;
  const corpsBrut = JSON.stringify(corps);
  const entetes: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cle) entetes['x-api-key'] = cle;

  if (options.contratKolabimo) {
    // Le contrat publié : en-têtes nommés, et signature hexadécimale NUE du
    // corps brut — pas la forme horodatée « t=…,v1=… » de notre fil sortant.
    entetes['x-kolabimo-event'] = options.contratKolabimo;
    if (options.livraison) entetes['x-kolabimo-delivery'] = options.livraison;
    entetes['x-kolabimo-signature'] = options.signature ?? empreinteNue(cle, corpsBrut);
    const res = await fetch(`${API}/webhooks/kolabimo`, {
      method: 'POST',
      headers: entetes,
      body: corpsBrut,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as ReponseWebhook };
  }

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
  await ownerDb.reservation.deleteMany({
    where: { externalId: { in: [EXTERNAL_ID, EXTERNAL_ID_DOSSIER] } },
  });
  await ownerDb.acquereur.deleteMany({
    where: { kolabimoClientRef: { in: [CLIENT_REF, CLIENT_REF_DOSSIER] } },
  });
  await ownerDb.webhookEvent.deleteMany({ where: { dedupeKey: { contains: 'test-lot7' } } });
  await ownerDb.webhookEvent.deleteMany({
    where: { dedupeKey: { contains: 'test-lot7-etape' } },
  });
  if (bac) {
    await ownerDb.webhookEvent.deleteMany({ where: { dedupeKey: { contains: `:${bac}-` } } });
    await ownerDb.encaissement.deleteMany({
      where: { appelDeFonds: { reservation: { operationId: bac } } },
    });
    await ownerDb.appelDeFonds.deleteMany({ where: { reservation: { operationId: bac } } });
    await ownerDb.reservation.deleteMany({ where: { operationId: bac } });
    await ownerDb.acquereur.deleteMany({ where: { kolabimoClientRef: 'test-lot7-cli-bac' } });
    await ownerDb.acquereur.deleteMany({ where: { email: 'luc.tardif@example.ch' } });
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
    // La référence du dossier est portée par la réservation elle-même : avant
    // `FONDS_VERSES` c'est la seule identité qui existe.
    expect(reservation.kolabimoClientRef).toBe(CLIENT_REF);
    expect(reservation.acquereur?.kolabimoClientRef).toBe(CLIENT_REF);

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
//  Fin de jalon — Kolabimo est maître depuis le 02.09.2026
// ---------------------------------------------------------------------

describe('Fin de jalon', () => {
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
    lotBac = lot.body.id;

    const acquereur = await appel<{ id: number }>('/acquereurs', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Passerelle', prenom: 'Test', email: 'passerelle@example.ch' },
    });
    await ownerDb.acquereur.update({
      where: { id: acquereur.body.id },
      data: { kolabimoClientRef: 'test-lot7-cli-bac' },
    });
    const reservation = await appel<{ id: number }>(`/operations/${bac}/reservations`, {
      methode: 'POST',
      token: christophe,
      corps: {
        lotId: lot.body.id,
        acquereurId: acquereur.body.id,
        statut: 'RESERVE',
        externalId: 'test-lot7-res-bac',
      },
    });
    // Le dossier passe par la table de liaison : c'est elle qui porte les
    // destinataires depuis que Kolabimo livre N personnes. L'API la remplit
    // à la création — une réservation saisie à la main n'a qu'une personne.
    reservationBac = reservation.body.id;

    const etape = await appel<{ id: number }>(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 1, libelle: 'Signature de l’acte', pourcentage: '10' },
    });
    etapeBac = etape.body.id;
  });

  it('reste possible depuis Prometis tant que l’opération n’est pas reliée à Kolabimo', async () => {
    const res = await appel<{ appelsCrees: number; declenchePar: string }>(
      `/operations/${bac}/echeancier/${etapeBac}/declencher`,
      { methode: 'POST', token: christophe, corps: { envoyer: false } },
    );
    expect(res.ok).toBe(true);
    expect(res.body.appelsCrees).toBe(1);
    expect(res.body.declenchePar).toBe('prometis');
  });

  it('ne pousse plus rien vers Kolabimo : la flèche est inversée', async () => {
    // Le 02.09.2026, `echeancier.etape_completed` change de sens. Prometis ne
    // doit plus l'émettre : deux maîtres sur un événement qui déclenche des
    // factures, c'est le piège à éviter.
    const sortants = await ownerDb.webhookEvent.count({
      where: { dedupeKey: { startsWith: 'prometis:echeancier.etape_completed:' } },
    });
    expect(sortants).toBe(0);
  });

  it('rejouer le déclenchement ne facture pas deux fois', async () => {
    await appel(`/operations/${bac}/echeancier/${etapeBac}/declencher`, {
      methode: 'POST',
      token: christophe,
      corps: { envoyer: false },
    });
    const appels = await ownerDb.appelDeFonds.count({ where: { etapeId: etapeBac } });
    expect(appels).toBe(1);
  });

  it('est REFUSÉE depuis Prometis dès que l’opération est reliée à Kolabimo', async () => {
    // Le promoteur marque ses étapes dans Kolabimo, parce que c'est ce qui
    // informe les agences — et parce qu'un seul endroit doit déclencher des
    // factures.
    await ownerDb.operation.update({
      where: { id: bac },
      data: { kolabimoPromotionId: PROMOTION_BAC },
    });
    const etape = await appel<{ id: number }>(`/operations/${bac}/echeancier`, {
      methode: 'POST',
      token: christophe,
      corps: { ordre: 2, libelle: 'Dalle sur rez', pourcentage: '20' },
    });
    etapeBacDeux = etape.body.id;

    const res = await appel<{ message?: string }>(
      `/operations/${bac}/echeancier/${etapeBacDeux}/declencher`,
      { methode: 'POST', token: christophe, corps: { envoyer: false } },
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Kolabimo');

    const etat = await ownerDb.echeancierEtape.findUniqueOrThrow({ where: { id: etapeBacDeux } });
    expect(etat.statut).not.toBe('COMPLETED');
  });

  it('accepte le jalon quand il vient de Kolabimo, et en tire les appels', async () => {
    await ownerDb.echeancierEtape.update({
      where: { id: etapeBacDeux },
      data: { kolabimoEtapeId: 7702 },
    });

    const res = await envoyerWebhook(
      {
        event: 'echeancier.etape_completed',
        delivery: 'test-lot7-etape-001',
        emisLe: new Date().toISOString(),
        promotion: { id: PROMOTION_BAC, nom: 'Bac à sable' },
        etape: {
          id: 7702,
          ordre: 2,
          libelle: 'Dalle sur rez',
          pourcentage: '20',
          statut: 'COMPLETED',
          dateCompletion: '2026-09-02',
        },
      },
      { contratKolabimo: 'echeancier.etape_completed', livraison: 'test-lot7-etape-001' },
    );

    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.action).toBe('jalon_cloture');

    const etat = await ownerDb.echeancierEtape.findUniqueOrThrow({ where: { id: etapeBacDeux } });
    expect(etat.statut).toBe('COMPLETED');
    // `syncedAt` ne dit plus « poussé vers Kolabimo » mais « aligné sur lui ».
    expect(etat.syncedAt).not.toBeNull();

    const appels = await ownerDb.appelDeFonds.findMany({ where: { etapeId: etapeBacDeux } });
    expect(appels).toHaveLength(1);
    // 20 % de 800 000 = 160 000.
    expect(appels[0]!.montant.toFixed(2)).toBe('160000.00');
  });

  it('un second envoi du même jalon ne refacture rien', async () => {
    const res = await envoyerWebhook(
      {
        event: 'echeancier.etape_completed',
        delivery: 'test-lot7-etape-002',
        promotion: { id: PROMOTION_BAC },
        etape: { id: 7702, statut: 'COMPLETED', dateCompletion: '2026-09-02' },
      },
      { contratKolabimo: 'echeancier.etape_completed', livraison: 'test-lot7-etape-002' },
    );
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.action).toBe('sans_changement');

    const appels = await ownerDb.appelDeFonds.count({ where: { etapeId: etapeBacDeux } });
    expect(appels).toBe(1);
  });

  it('le journal expose l’événement sortant restant — les encaissements', async () => {
    const appelDeFonds = await ownerDb.appelDeFonds.findFirstOrThrow({
      where: { etapeId: etapeBac },
    });
    await appel(`/operations/${bac}/appels-de-fonds/${appelDeFonds.id}/encaissements`, {
      methode: 'POST',
      token: christophe,
      corps: { montant: '1000', dateValeur: '2026-09-02' },
    });

    const journal = await appel<{ id: number; source: string; evenement: string }[]>(
      '/passerelle/journal?source=prometis&limite=200',
      { token: christophe },
    );
    const sortant = journal.body.find((e) => e.evenement === 'encaissement.enregistre');
    expect(sortant).toBeDefined();

    const rejeu = await appel<{ sens: string; livre: boolean; raison?: string }>(
      `/passerelle/journal/${sortant!.id}/rejouer`,
      { methode: 'POST', token: christophe },
    );
    expect(rejeu.body.sens).toBe('sortant');
    // La passerelle n'est pas configurée en développement : la livraison
    // échoue, et l'événement reste rejouable. C'est le comportement voulu.
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

// ---------------------------------------------------------------------
//  Le palier FONDS_VERSES — l'identité arrive après la réservation
// ---------------------------------------------------------------------

describe('Dossier acquéreur à N personnes', () => {
  /** Le corps du contrat Kolabimo, sans identité : la référence seule. */
  function dossier(surcharge: Record<string, unknown> = {}) {
    return {
      externalId: EXTERNAL_ID_DOSSIER,
      id: 9202,
      appartementId: APPARTEMENT_DOSSIER,
      statut: 'reserve',
      dateReservation: '2026-08-15',
      client: { reference: CLIENT_REF_DOSSIER },
      ...surcharge,
    };
  }

  it('crée la réservation SANS acquéreur nominatif avant le palier', async () => {
    const res = await envoyerWebhook(
      { event: 'reservation.created', reservation: dossier() },
      { contratKolabimo: 'reservation.created', livraison: 'test-lot7-dossier-001' },
    );
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.identiteConnue).toBe(false);

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID_DOSSIER },
      include: { acquereurs: true },
    });
    // Ni nom, ni e-mail, ni acquéreur « inconnu » inventé : la référence
    // pseudonyme, et rien d'autre. C'est ce qui empêche Prometis de servir de
    // porte de derrière à ce que Kolabimo cache encore au promoteur.
    expect(reservation.acquereurId).toBeNull();
    expect(reservation.acquereurs).toHaveLength(0);
    expect(reservation.kolabimoClientRef).toBe(CLIENT_REF_DOSSIER);
  });

  it('retrouve l’opération par le lot, sans que la promotion soit dans le corps', async () => {
    // Le contrat Kolabimo ne porte pas la promotion. Le rattachement par le
    // lot donne au passage le bon comportement hors périmètre.
    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID_DOSSIER },
      include: { operation: true },
    });
    expect(reservation.operation.kolabimoPromotionId).toBe(PROMOTION_KOLABIMO);
  });

  it('complète le dossier à FONDS_VERSES : trois personnes, rôles et quotes-parts', async () => {
    const res = await envoyerWebhook(
      {
        event: 'reservation.step_changed',
        reservation: dossier({
          statut: 'fonds_verses',
          client: {
            reference: CLIENT_REF_DOSSIER,
            niveau: 'COMPLET',
            regime: 'INDIVISION',
            personnes: [
              {
                role: 'ACQUEREUR',
                type: 'PHYSIQUE',
                nom: 'Rossier',
                prenom: 'Anne',
                email: 'anne.rossier@example.ch',
                adresse: 'Rue du Lac 12',
                npa: '1920',
                localite: 'Martigny',
                quotePart: '1/2',
                signataire: true,
              },
              {
                role: 'CO_ACQUEREUR',
                type: 'PHYSIQUE',
                nom: 'Rossier',
                prenom: 'Marc',
                email: 'marc.rossier@example.ch',
                quotePart: '1/4',
              },
              {
                role: 'SOCIETE',
                type: 'MORALE',
                raisonSociale: 'Rossier Immobilier SA',
                ide: 'CHE-123.456.789',
                quotePart: '1/4',
              },
            ],
          },
        }),
      },
      { contratKolabimo: 'reservation.step_changed', livraison: 'test-lot7-dossier-002' },
    );
    expect(res.body.statut).toBe('TRAITE');
    expect(res.body.detail?.personnes).toBe(3);

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID_DOSSIER },
      include: { acquereurs: { orderBy: { ordre: 'asc' }, include: { acquereur: true } } },
    });
    expect(reservation.statut).toBe('FONDS_VERSES');
    expect(reservation.acquereurs).toHaveLength(3);
    expect(reservation.acquereurs.map((l) => l.role)).toEqual([
      'ACQUEREUR',
      'CO_ACQUEREUR',
      'SOCIETE',
    ]);
    // Quote-part en FRACTION, jamais en pourcentage : c'est ce que porte
    // l'acte, et 1/3 ne s'arrondit pas.
    expect(reservation.acquereurs.map((l) => l.quotePart)).toEqual(['1/2', '1/4', '1/4']);
    // Contact principal : le signataire. Pointeur dérivé, pas seconde vérité.
    expect(reservation.acquereurId).toBe(reservation.acquereurs[0]!.acquereurId);
    expect(reservation.acquereurs[2]!.acquereur.raisonSociale).toBe('Rossier Immobilier SA');
  });

  it('un événement suivant SANS identité n’efface pas le dossier', async () => {
    // Kolabimo n'envoie pas un tableau vide : il n'envoie pas le champ.
    // Confondre les deux effacerait ce qu'on vient de recevoir.
    const res = await envoyerWebhook(
      { event: 'reservation.validated', reservation: dossier({ statut: 'vendu' }) },
      { contratKolabimo: 'reservation.validated', livraison: 'test-lot7-dossier-003' },
    );
    expect(res.body.statut).toBe('TRAITE');

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID_DOSSIER },
      include: { acquereurs: true },
    });
    expect(reservation.statut).toBe('VENDU');
    expect(reservation.acquereurs).toHaveLength(3);
  });

  it('une liste réduite retire la personne sortie du dossier', async () => {
    // Kolabimo est maître du client : une indivision qui perd un membre doit
    // le perdre chez nous aussi. On recale, on ne fusionne pas.
    await envoyerWebhook(
      {
        event: 'reservation.step_changed',
        reservation: dossier({
          statut: 'vendu',
          client: {
            reference: CLIENT_REF_DOSSIER,
            personnes: [
              {
                role: 'ACQUEREUR',
                nom: 'Rossier',
                prenom: 'Anne',
                email: 'anne.rossier@example.ch',
                quotePart: '1/1',
                signataire: true,
              },
            ],
          },
        }),
      },
      { contratKolabimo: 'reservation.step_changed', livraison: 'test-lot7-dossier-004' },
    );

    const reservation = await ownerDb.reservation.findUniqueOrThrow({
      where: { externalId: EXTERNAL_ID_DOSSIER },
      include: { acquereurs: true },
    });
    expect(reservation.acquereurs).toHaveLength(1);
    expect(reservation.acquereurs[0]!.quotePart).toBe('1/1');
  });
});

// ---------------------------------------------------------------------
//  Rattrapage — le promoteur choisit, rien n'est appelé d'office
// ---------------------------------------------------------------------

describe('Rattrapage du premier appel d’un lot', () => {
  let reservationTardive = 0;

  beforeAll(async () => {
    // Un lot vendu alors que deux jalons sont derrière lui.
    const lot = await appel<{ id: number }>(
      `/operations/${bac}/biens/${(await ownerDb.bien.findFirstOrThrow({ where: { operationId: bac } })).id}/lots`,
      { methode: 'POST', token: christophe, corps: { reference: 'K02', prixVente: '600000' } },
    );
    const acquereur = await appel<{ id: number }>('/acquereurs', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Tardif', prenom: 'Luc', email: 'luc.tardif@example.ch' },
    });
    const reservation = await appel<{ id: number }>(`/operations/${bac}/reservations`, {
      methode: 'POST',
      token: christophe,
      corps: {
        lotId: lot.body.id,
        acquereurId: acquereur.body.id,
        statut: 'FONDS_VERSES',
        externalId: 'test-lot7-res-tardive',
      },
    });
    reservationTardive = reservation.body.id;
  });

  it('rien n’a été appelé d’office : le rattrapage n’est PAS automatique', async () => {
    // Les tranches passées peuvent figurer dans l'acte et avoir été réglées
    // à la signature. Les appeler seules reviendrait à réclamer à un
    // acquéreur ce qu'il vient de payer.
    const appels = await ownerDb.appelDeFonds.count({
      where: { reservationId: reservationTardive },
    });
    expect(appels).toBe(0);
  });

  it('propose les étapes déjà closes, avec leur montant', async () => {
    const res = await appel<{
      etapes: { etapeId: number; libelle: string; montant: string; dejaAppelee: boolean }[];
      enAttente: number;
      montantAChoisir: string;
    }>(`/operations/${bac}/reservations/${reservationTardive}/rattrapage`, { token: christophe });

    expect(res.ok).toBe(true);
    // Les deux jalons clos de l'opération : 10 % et 20 % de 600 000.
    expect(res.body.enAttente).toBe(2);
    const montants = res.body.etapes.map((e) => e.montant).sort();
    expect(montants).toEqual(['120000.00', '60000.00']);
    expect(res.body.montantAChoisir).toBe('180000.00');
  });

  it('n’appelle QUE les étapes choisies', async () => {
    const vue = await appel<{ etapes: { etapeId: number; pourcentage: string }[] }>(
      `/operations/${bac}/reservations/${reservationTardive}/rattrapage`,
      { token: christophe },
    );
    // Le promoteur ne retient qu'un des deux jalons : l'autre figure dans
    // l'acte et a été réglé chez le notaire.
    const choisie = vue.body.etapes.find((e) => e.pourcentage.startsWith('20'))!;

    const res = await appel<{ appelsCrees: number; montantTotal: string }>(
      `/operations/${bac}/reservations/${reservationTardive}/rattrapage`,
      {
        methode: 'POST',
        token: christophe,
        corps: { etapeIds: [choisie.etapeId], envoyer: false },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.body.appelsCrees).toBe(1);
    expect(res.body.montantTotal).toBe('120000.00');

    const appels = await ownerDb.appelDeFonds.findMany({
      where: { reservationId: reservationTardive },
    });
    expect(appels).toHaveLength(1);
    expect(appels[0]!.etapeId).toBe(choisie.etapeId);
  });

  it('rejouer le même choix ne facture pas deux fois', async () => {
    const appels = await ownerDb.appelDeFonds.findMany({
      where: { reservationId: reservationTardive },
    });
    const res = await appel<{ appelsCrees: number; ignorees: { raison: string }[] }>(
      `/operations/${bac}/reservations/${reservationTardive}/rattrapage`,
      {
        methode: 'POST',
        token: christophe,
        corps: { etapeIds: [appels[0]!.etapeId], envoyer: false },
      },
    );
    expect(res.body.appelsCrees).toBe(0);
    expect(res.body.ignorees[0]!.raison).toContain('déjà émis');
  });

  it('refuse une liste vide : « aucune » et « toutes » ne se confondent pas', async () => {
    const res = await appel(`/operations/${bac}/reservations/${reservationTardive}/rattrapage`, {
      methode: 'POST',
      token: christophe,
      corps: { etapeIds: [], envoyer: false },
    });
    expect(res.status).toBe(400);
  });
});
