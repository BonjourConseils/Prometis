/**
 * La connexion d'une société à SON compte Kolabimo — clé saisie dans Prometis,
 * lecture d'une promotion, rattachement, et webhooks signés par un secret
 * distinct de la clé.
 *
 * Kolabimo est simulé par un petit serveur HTTP local qui rend **exactement**
 * les formes relevées dans son code (`ImmoCollab/src/routes/api/v1/*.js`,
 * v1.3.20) : c'est le contrat réel qu'on éprouve, pas une idée du contrat.
 * L'API Prometis, lancée par `npm run verifier`, l'appelle comme elle
 * appellerait kolabimo.ch.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, CONSTRUCTA, apiDisponible, appel, jetonPourEspace } from './api-client';
import { asTenant, ownerDb } from './tenant-db';
import { empreinteNue } from '../apps/api/src/passerelle/signature';

const CLE_PROMOTEUR = 'kolabimo_' + 'a'.repeat(56) + 'f00d';
const CLE_AGENCE = 'kolabimo_' + 'b'.repeat(60);
const PROMOTION = 77_301;
const APPART_1 = 88_401;
const APPART_2 = 88_402;
const APPART_3 = 88_403;
const AUTRE_PROMOTION_APPART = 99_999;

// ---------------------------------------------------------------------
//  Le faux Kolabimo
// ---------------------------------------------------------------------

let kolabimo: Server;
let kolabimoUrl = '';
const requetes: { chemin: string; cle: string | undefined }[] = [];

/** Réservations rendues par `GET /api/v1/reservations` — modifiables par test. */
let reservationsKolabimo: unknown[] = [];

function repondre(chemin: string, cle: string | undefined): { statut: number; corps: unknown } {
  if (cle === CLE_AGENCE && chemin === '/api/v1/me') {
    return {
      statut: 200,
      corps: { type: 'AGENCE', id: 4, nom: 'Agence du Rhône', email: 'a@x.ch' },
    };
  }
  if (cle !== CLE_PROMOTEUR)
    return { statut: 401, corps: { error: 'API key invalide ou inactive' } };

  switch (chemin) {
    case '/api/v1/me':
      return {
        statut: 200,
        corps: { type: 'PROMOTEUR', id: 3, nom: 'CB Promotions SA', email: 'c@cb.ch' },
      };
    case '/api/v1/promotions':
      return {
        statut: 200,
        corps: {
          count: 1,
          promotions: [
            {
              id: PROMOTION,
              nom: 'Immeuble test passerelle',
              statut: 'EN_COMMERCIALISATION',
              localisation: 'Martigny',
              photoUrl: null,
              promoteur: { id: 3, nom: 'CB Promotions SA' },
            },
          ],
        },
      };
    case `/api/v1/promotions/${PROMOTION}/lots`:
      return {
        statut: 200,
        corps: {
          promotionId: PROMOTION,
          promotionNom: 'Immeuble test passerelle',
          promotionStatut: 'EN_COMMERCIALISATION',
          promotionLocalisation: 'Martigny',
          promotionPhotoUrl: null,
          promoteurId: 3,
          promoteurNom: 'CB Promotions SA',
          statutFiltre: null,
          count: 3,
          disponiblesCount: 1,
          lots: [
            lot(
              APPART_1,
              'TP-101',
              1,
              585000,
              [{ reference: 'PK-12', type: 'INTERIEURE', prix: 45000 }],
              'EN_ATTENTE_NOTAIRE',
            ),
            lot(APPART_2, 'TP-102', 1, 610000, [], 'RESERVE'),
            lot(
              APPART_3,
              'TP-201',
              2,
              640000,
              [{ reference: 'BX-3', type: 'BOX', prix: 35000 }],
              'DISPONIBLE',
            ),
          ],
        },
      };
    case `/api/v1/promotions/${PROMOTION}/echeancier`:
      return {
        statut: 200,
        corps: {
          promotionId: PROMOTION,
          promotionNom: 'Immeuble test passerelle',
          totalPourcentage: 100,
          complet: true,
          count: 3,
          etapes: [
            etape(501, 1, "Signature de l'acte", 30, 'COMPLETED', '2026-08-20T00:00:00.000Z'),
            etape(502, 2, 'Gros œuvre', 50, 'NOT_STARTED', null),
            etape(503, 3, 'Remise des clés', 20, 'NOT_STARTED', null),
          ],
        },
      };
    case '/api/v1/reservations':
      return { statut: 200, corps: reservationsKolabimo };
    // Kolabimo 1.3.21 : le rattrapage d'identité, au même palier que le
    // webhook. Avant FONDS_VERSES, la référence seule — même ici.
    case '/api/v1/reservations/9001/dossier':
      return {
        statut: 200,
        corps: {
          id: 9_001,
          externalId: null,
          statut: 'FONDS_VERSES',
          appartementId: APPART_1,
          bienRef: 'TP-101',
          client: {
            reference: 'dossier-9001',
            niveau: 'COMPLET',
            regime: 'COPROPRIETE',
            personnes: [
              {
                role: 'PRINCIPAL',
                type: 'PHYSIQUE',
                nom: 'Berger',
                prenom: 'Nina',
                email: 'nina@x.ch',
                quotePart: '1/2',
                signataire: true,
              },
              {
                role: 'CONJOINT',
                type: 'PHYSIQUE',
                nom: 'Berger',
                prenom: 'Yves',
                email: 'yves@x.ch',
                quotePart: '1/2',
              },
            ],
          },
        },
      };
    default:
      return { statut: 404, corps: { error: 'Promotion introuvable' } };
  }
}

function lot(
  id: number,
  reference: string,
  etage: number,
  prixVente: number,
  parkings: { reference: string; type: string; prix: number }[],
  statut: string,
) {
  const parkingsTotal = parkings.reduce((s, p) => s + p.prix, 0);
  return {
    id,
    reference,
    immeubleId: 12,
    immeubleNom: 'Bâtiment A',
    etage,
    nombrePieces: 3.5,
    surfaceM2: 98.16,
    prixVente,
    parkings,
    parkingsCount: parkings.length,
    parkingsTotal,
    prixTotalActe: prixVente + parkingsTotal,
    statut,
    statutEffectif: statut,
    disponible: statut === 'DISPONIBLE',
  };
}

function etape(
  id: number,
  ordre: number,
  libelle: string,
  pourcentage: number,
  statut: string,
  dateCompletion: string | null,
) {
  return {
    id,
    ordre,
    libelle,
    description: null,
    pourcentage,
    dateIndicative: null,
    statut,
    dateCompletion,
    datePrevue: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/** Une ligne de `GET /api/v1/reservations`, sans identité — jamais. */
function reservationK(
  id: number,
  appartementId: number,
  statut: string,
  externalId: string | null,
) {
  return {
    id,
    statut,
    agenceId: 4,
    clientReference: `dossier-${id}`,
    montantVersement: '20000',
    dateLimiteVersement: null,
    dateLimiteSignature: null,
    versementEffectue: statut !== 'RESERVE',
    dateVersement: null,
    dateSignature: null,
    externalId,
    createdAt: '2026-08-01T10:00:00.000Z',
    appartement: { id: appartementId, reference: `APP-${appartementId}`, statut: 'RESERVE' },
    partageBien: null,
    agence: { id: 4, nom: 'Agence du Rhône', email: 'a@x.ch' },
  };
}

// ---------------------------------------------------------------------

let christophe: string;
let julie: string;
let marc: string;
let secretWebhook = '';
let urlWebhook = '';
let operationCreee = 0;

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Lancer « npm run verifier ».`);
  }

  kolabimo = createServer((req, res) => {
    const cle = req.headers['x-api-key'] as string | undefined;
    const chemin = (req.url ?? '').split('?')[0]!;
    requetes.push({ chemin, cle });
    const { statut, corps } = repondre(chemin, cle);
    res.writeHead(statut, { 'content-type': 'application/json' });
    res.end(JSON.stringify(corps));
  });
  await new Promise<void>((ok) => kolabimo.listen(0, '127.0.0.1', ok));
  kolabimoUrl = `http://127.0.0.1:${(kolabimo.address() as AddressInfo).port}`;

  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  julie = await jetonPourEspace(COMPTES.julie, CB);
  marc = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

  // Une connexion laissée par un passage précédent fausserait le test du
  // secret « montré une seule fois ».
  await ownerDb.connexionKolabimo.deleteMany({ where: { societeId: CB } });

  reservationsKolabimo = [
    reservationK(9_001, APPART_1, 'FONDS_VERSES', null),
    reservationK(9_002, APPART_2, 'RESERVE', 'crm-uuid-9002'),
    // D'une autre promotion du même promoteur : l'API ne filtre pas, nous si.
    reservationK(9_003, AUTRE_PROMOTION_APPART, 'RESERVE', null),
  ];
});

afterAll(async () => {
  if (operationCreee) {
    await ownerDb.appelDeFonds.deleteMany({
      where: { reservation: { operationId: operationCreee } },
    });
    await ownerDb.reservation.deleteMany({ where: { operationId: operationCreee } });
    await ownerDb.echeancierEtape.deleteMany({ where: { operationId: operationCreee } });
    await ownerDb.parking.deleteMany({ where: { lot: { bien: { operationId: operationCreee } } } });
    await ownerDb.lot.deleteMany({ where: { bien: { operationId: operationCreee } } });
    await ownerDb.bien.deleteMany({ where: { operationId: operationCreee } });
    await ownerDb.operationAccess.deleteMany({ where: { operationId: operationCreee } });
    await ownerDb.auditLog.deleteMany({ where: { entite: 'Operation', entiteId: operationCreee } });
    await ownerDb.operation.delete({ where: { id: operationCreee } });
  }
  await ownerDb.acquereur.deleteMany({ where: { kolabimoClientRef: { startsWith: 'dossier-9' } } });
  await ownerDb.connexionKolabimo.deleteMany({ where: { societeId: CB } });
  await ownerDb.auditLog.deleteMany({ where: { entite: 'ConnexionKolabimo' } });
  await ownerDb.webhookEvent.deleteMany({ where: { dedupeKey: { contains: 'test-cx-' } } });
  await new Promise<void>((ok) => kolabimo.close(() => ok()));
  await ownerDb.$disconnect();
});

// ---------------------------------------------------------------------
//  Saisir la clé
// ---------------------------------------------------------------------

describe('Saisir la clé Kolabimo', () => {
  it('refuse une clé que Kolabimo ne reconnaît pas — et le dit', async () => {
    const res = await appel<{ message: string }>('/passerelle/kolabimo', {
      methode: 'PUT',
      token: christophe,
      corps: { baseUrl: kolabimoUrl, cleApi: 'kolabimo_' + 'c'.repeat(60) },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Clé refusée par Kolabimo');
  });

  it('refuse une clé d’AGENCE : Prometis gère l’argent du promoteur', async () => {
    const res = await appel<{ message: string }>('/passerelle/kolabimo', {
      methode: 'PUT',
      token: christophe,
      corps: { baseUrl: kolabimoUrl, cleApi: CLE_AGENCE },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pas à un promoteur');
  });

  it('refuse une adresse en http hors du poste local : la clé voyage dans chaque requête', async () => {
    const res = await appel<{ message: string }>('/passerelle/kolabimo', {
      methode: 'PUT',
      token: christophe,
      corps: { baseUrl: 'http://kolabimo.ch', cleApi: CLE_PROMOTEUR },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('https');
  });

  it('un chef de projet ne peut pas poser la clé : elle ouvre toutes les promotions', async () => {
    const res = await appel('/passerelle/kolabimo', {
      methode: 'PUT',
      token: julie,
      corps: { baseUrl: kolabimoUrl, cleApi: CLE_PROMOTEUR },
    });
    expect(res.status).toBe(403);
  });

  it('enregistre une clé de promoteur, après l’avoir essayée', async () => {
    const res = await appel<{
      etat: {
        connectee: boolean;
        cleApercu: string;
        promoteur: { nom: string };
        webhook: { url: string };
      };
      secretWebhook: string | null;
    }>('/passerelle/kolabimo', {
      methode: 'PUT',
      token: christophe,
      corps: { baseUrl: kolabimoUrl, cleApi: CLE_PROMOTEUR },
    });
    expect(res.status).toBe(200);
    expect(res.body.etat.connectee).toBe(true);
    expect(res.body.etat.promoteur.nom).toBe('CB Promotions SA');
    expect(res.body.etat.cleApercu).toBe('…f00d');
    expect(res.body.etat.webhook.url).toMatch(/\/webhooks\/kolabimo\/[A-Za-z0-9_-]{20,}$/);
    // Le secret de webhook sort ICI, et nulle part ailleurs.
    expect(res.body.secretWebhook).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    secretWebhook = res.body.secretWebhook!;
    urlWebhook = res.body.etat.webhook.url;
  });

  it('ne renvoie jamais la clé, ni le secret, dans l’état', async () => {
    const res = await appel('/passerelle/kolabimo', { token: christophe });
    const texte = JSON.stringify(res.body);
    expect(texte).not.toContain(CLE_PROMOTEUR);
    expect(texte).not.toContain(secretWebhook);
  });

  it('stocke la clé et le secret chiffrés, jamais en clair', async () => {
    const ligne = await ownerDb.connexionKolabimo.findUniqueOrThrow({ where: { societeId: CB } });
    expect(ligne.cleApiChiffree).not.toContain(CLE_PROMOTEUR);
    expect(ligne.cleApiChiffree).toMatch(/^v1\./);
    expect(ligne.secretWebhookChiffre).not.toContain(secretWebhook);
  });

  it('remplacer la clé ne remontre pas le secret de webhook', async () => {
    const res = await appel<{ secretWebhook: string | null }>('/passerelle/kolabimo', {
      methode: 'PUT',
      token: christophe,
      corps: { baseUrl: kolabimoUrl, cleApi: CLE_PROMOTEUR },
    });
    expect(res.body.secretWebhook).toBeNull();
  });

  it('la connexion d’une société est invisible de l’autre', async () => {
    expect(await asTenant(CONSTRUCTA, (tx) => tx.connexionKolabimo.count())).toBe(0);
    const res = await appel<{ connectee: boolean }>('/passerelle/kolabimo', { token: marc });
    expect(res.body.connectee).toBe(false);
  });
});

// ---------------------------------------------------------------------
//  Lire une promotion
// ---------------------------------------------------------------------

describe('Lire une promotion Kolabimo', () => {
  it('liste les promotions de la clé', async () => {
    const res = await appel<{ id: number; nom: string; operation: unknown }[]>(
      '/passerelle/kolabimo/promotions',
      { token: christophe },
    );
    expect(res.ok).toBe(true);
    expect(res.body.map((p) => p.id)).toEqual([PROMOTION]);
    expect(res.body[0]!.operation).toBeNull();
    // C'est bien la clé de CB qui est partie — la seule qu'ait cette société.
    expect(requetes.at(-1)!.cle).toBe(CLE_PROMOTEUR);
  });

  it('rend la photo : lots, prix total acte, échéancier, réservations DE CETTE promotion', async () => {
    const res = await appel<{
      lots: { reference: string; prixTotalActe: number }[];
      echeancier: { complet: boolean; etapes: unknown[] };
      reservations: { id: number }[];
    }>(`/passerelle/kolabimo/promotions/${PROMOTION}`, { token: christophe });
    expect(res.ok).toBe(true);
    expect(res.body.lots.map((l) => l.prixTotalActe)).toEqual([630000, 610000, 675000]);
    expect(res.body.echeancier.complet).toBe(true);
    // 9003 appartient à une autre promotion : l'API ne filtre pas, nous si.
    expect(res.body.reservations.map((r) => r.id).sort()).toEqual([9001, 9002]);
  });

  it('une promotion hors du périmètre de la clé renvoie une erreur lisible', async () => {
    const res = await appel<{ message: string }>('/passerelle/kolabimo/promotions/424242', {
      token: christophe,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('hors du périmètre');
  });

  it('une société sans clé est invitée à la saisir', async () => {
    const res = await appel<{ message: string }>('/passerelle/kolabimo/promotions', {
      token: marc,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("n'est pas connecté");
  });
});

// ---------------------------------------------------------------------
//  Rattacher, et synchroniser
// ---------------------------------------------------------------------

describe('Rattacher une promotion à une opération Prometis', () => {
  it('crée l’opération, ses lots, ses parkings, son échéancier et ses réservations', async () => {
    const res = await appel<{
      operation: { id: number; nom: string };
      lots: { crees: number };
      parkings: { crees: number };
      echeancier: { creees: number; refus: string[] };
      reservations: { recues: number; traitees: number; enErreur: number; erreurs: string[] };
    }>(`/passerelle/kolabimo/promotions/${PROMOTION}/rattacher`, {
      methode: 'POST',
      token: christophe,
      corps: {},
    });
    expect(res.status).toBe(200);
    operationCreee = res.body.operation.id;
    expect(res.body.operation.nom).toBe('Immeuble test passerelle');
    expect(res.body.lots.crees).toBe(3);
    expect(res.body.parkings.crees).toBe(2);
    expect(res.body.echeancier.creees).toBe(3);
    expect(res.body.echeancier.refus).toEqual([]);
    expect(res.body.reservations).toMatchObject({ recues: 2, traitees: 2, enErreur: 0 });
  });

  it('rattrape l’identité d’un dossier déjà passé le palier', async () => {
    // Le webhook du palier est parti avant notre raccordement, et Kolabimo ne
    // le rejoue pas : sans la route `/dossier`, cet acquéreur resterait
    // anonyme, et son appel de fonds sans destinataire.
    const reservation = await ownerDb.reservation.findFirstOrThrow({
      where: { kolabimoReservationId: 9_001 },
      include: { acquereurs: { orderBy: { ordre: 'asc' }, include: { acquereur: true } } },
    });
    expect(reservation.acquereurs).toHaveLength(2);
    expect(reservation.acquereurs.map((l) => l.acquereur.prenom)).toEqual(['Nina', 'Yves']);
    expect(reservation.acquereurs.map((l) => l.quotePart)).toEqual(['1/2', '1/2']);
    // Contact principal dérivé : le signataire.
    expect(reservation.acquereurId).toBe(reservation.acquereurs[0]!.acquereurId);
  });

  it('ne demande PAS l’identité d’un dossier en deçà du palier', async () => {
    // 9002 est en RESERVE : Kolabimo ne rendrait que la référence, qu'on a
    // déjà. L'appel serait un aller-retour pour rien.
    expect(requetes.some((r) => r.chemin === '/api/v1/reservations/9002/dossier')).toBe(false);
    const reservation = await ownerDb.reservation.findFirstOrThrow({
      where: { kolabimoReservationId: 9_002 },
      include: { acquereurs: true },
    });
    expect(reservation.acquereurs).toHaveLength(0);
  });

  it('le prix total acte d’une réservation reprend le lot ET ses parkings', async () => {
    const reservation = await ownerDb.reservation.findFirstOrThrow({
      where: { kolabimoReservationId: 9_001 },
    });
    expect(reservation.prixTotalActe?.toFixed(2)).toBe('630000.00');
    expect(reservation.statut).toBe('FONDS_VERSES');
    // `externalId` nul chez Kolabimo → nul chez nous, sans faire échouer.
    expect(reservation.externalId).toBeNull();
  });

  it('une étape déjà close arrive close — SANS appel de fonds', async () => {
    const etape = await ownerDb.echeancierEtape.findFirstOrThrow({
      where: { operationId: operationCreee, kolabimoEtapeId: 501 },
    });
    expect(etape.statut).toBe('COMPLETED');
    // Le rattrapage n'est jamais automatique : c'est au promoteur de choisir.
    expect(
      await ownerDb.appelDeFonds.count({ where: { reservation: { operationId: operationCreee } } }),
    ).toBe(0);
  });

  it('rejouer la synchronisation ne duplique rien', async () => {
    const res = await appel<{
      lots: { crees: number; misAJour: number };
      echeancier: { creees: number };
      reservations: { identitesRecuperees: number };
    }>(`/operations/${operationCreee}/passerelle/synchroniser`, {
      methode: 'POST',
      token: christophe,
    });
    expect(res.status).toBe(200);
    expect(res.body.lots).toMatchObject({ crees: 0, misAJour: 3 });
    expect(res.body.reservations.identitesRecuperees).toBe(1);
    expect(res.body.echeancier.creees).toBe(0);
    expect(await ownerDb.lot.count({ where: { bien: { operationId: operationCreee } } })).toBe(3);
    expect(await ownerDb.reservation.count({ where: { operationId: operationCreee } })).toBe(2);
  });

  it('refuse de rattacher la même promotion à une seconde opération', async () => {
    const autre = await ownerDb.operation.findFirstOrThrow({
      where: { nom: 'Les Jardins de Prilly' },
    });
    const res = await appel(`/passerelle/kolabimo/promotions/${PROMOTION}/rattacher`, {
      methode: 'POST',
      token: christophe,
      corps: { operationId: autre.id },
    });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------
//  Les webhooks, par l'URL affichée et le secret distinct
// ---------------------------------------------------------------------

describe('Webhooks Kolabimo par l’URL de la connexion', () => {
  async function pousser(corps: unknown, secret: string, url = urlWebhook) {
    const brut = JSON.stringify(corps);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kolabimo-Event': (corps as { event: string }).event,
        'X-Kolabimo-Delivery': (corps as { delivery: string }).delivery,
        // Exactement ce que fait Kolabimo : ni clé d'API, ni horodatage.
        'X-Kolabimo-Signature': empreinteNue(secret, brut),
      },
      body: brut,
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as Record<string, unknown>,
    };
  }

  const vente = (delivery: string, statut: string, personnes?: unknown[]) => ({
    event: 'reservation.step_changed',
    delivery,
    emisLe: new Date().toISOString(),
    reservation: {
      id: 9_002,
      externalId: null,
      statut,
      appartementId: APPART_2,
      bienRef: 'TP-102',
      agenceId: 4,
      agenceNom: 'Agence du Rhône',
      dateReservation: '2026-08-01T10:00:00.000Z',
      dateVersement: '2026-09-05T10:00:00.000Z',
      dateSignature: null,
      montantVersement: 20000,
      client: personnes
        ? { reference: 'dossier-9002', niveau: 'COMPLET', regime: 'COPROPRIETE', personnes }
        : { reference: 'dossier-9002' },
    },
  });

  it('accepte un webhook signé avec le secret de la connexion', async () => {
    const res = await pousser(
      vente('test-cx-001', 'FONDS_VERSES', [
        {
          role: 'ACQUEREUR',
          type: 'PHYSIQUE',
          nom: 'Rey',
          prenom: 'Léa',
          email: 'lea@x.ch',
          quotePart: '1/2',
          signataire: true,
        },
        {
          role: 'ACQUEREUR',
          type: 'PHYSIQUE',
          nom: 'Rey',
          prenom: 'Tom',
          email: 'tom@x.ch',
          quotePart: '1/2',
          signataire: true,
        },
      ]),
      secretWebhook,
    );
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('TRAITE');
  });

  it('rapproche par l’identifiant Kolabimo quand externalId est nul — pas de doublon', async () => {
    // La réservation 9002 a été tirée avec l'externalId « crm-uuid-9002 » ;
    // le webhook arrive avec un externalId NUL. Même vente.
    const lignes = await ownerDb.reservation.findMany({
      where: { kolabimoReservationId: 9_002 },
      include: { acquereurs: true },
    });
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.statut).toBe('FONDS_VERSES');
    expect(lignes[0]!.acquereurs).toHaveLength(2);
  });

  it('refuse un webhook signé avec la CLÉ D’API au lieu du secret', async () => {
    // Deux secrets, deux sens : une clé qui fuit ne doit pas permettre de
    // forger des webhooks.
    const res = await pousser(vente('test-cx-002', 'VENDU'), CLE_PROMOTEUR);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton inconnu, avec la même réponse qu’une signature fausse', async () => {
    const url = urlWebhook.replace(/[^/]+$/, 'x'.repeat(32));
    const res = await pousser(vente('test-cx-003', 'VENDU'), secretWebhook, url);
    expect(res.status).toBe(401);
  });

  it('régénérer le secret invalide l’ancien aussitôt', async () => {
    const nouveau = await appel<{ secretWebhook: string }>('/passerelle/kolabimo/secret', {
      methode: 'POST',
      token: christophe,
    });
    expect(nouveau.status).toBe(200);
    expect(nouveau.body.secretWebhook).not.toBe(secretWebhook);

    const ancien = await pousser(vente('test-cx-004', 'VENDU'), secretWebhook);
    expect(ancien.status).toBe(401);
    const recent = await pousser(vente('test-cx-005', 'VENDU'), nouveau.body.secretWebhook);
    expect(recent.status).toBe(200);
    secretWebhook = nouveau.body.secretWebhook;
  });
});
