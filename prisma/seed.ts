/**
 * Seed de démonstration.
 *
 * DEUX tenants, et c'est le point : le second n'est pas du remplissage, c'est
 * le témoin du test d'isolation (`tests/rls-isolation.spec.ts`). Sans lui,
 * « le tenant A voit ses données » ne prouve rien.
 *
 *   1. Probat Promotions SA   — PROMOTEUR, tous modules.
 *                               Opération « Les Jardins de Prilly ».
 *   2. Constructa EG SA       — ENTREPRISE_GENERALE, chantier seulement.
 *                               Opération « Résidence du Lac ».
 *
 * Le seed tourne avec le rôle PROPRIÉTAIRE (DIRECT_DATABASE_URL) : il doit
 * écrire dans les deux tenants, donc contourner la RLS. C'est précisément
 * pour cela que l'application, elle, utilise `prometis_app`.
 *
 * Chiffres de référence verrouillés ici (cohérence avec le prototype) :
 *   · lot A02 : 815 000 + box 35 000 = prix total acte 850 000 CHF
 *   · appel de fonds 5 %  =  42 500 · 15 % = 127 500
 *   · Immeuble A (12 lots) + Immeuble B (8 lots) = 20 lots PPE
 *   · parcelles 2841 / 2842
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { config as loadDotenv } from 'dotenv';
import { CLE_API_CONSTRUCTA, CLE_API_PROBAT } from './passerelle-cles-dev';
import { genererReferenceQR } from '../apps/api/src/appels-de-fonds/qr-reference';

loadDotenv();

/**
 * Mot de passe de tous les comptes de démonstration.
 * Données de développement : ces comptes n'existent que dans une base locale.
 */
const MOT_DE_PASSE_DEV = 'Prometis!2026';
/** Paramètres OWASP pour argon2id — identiques à ceux de `PasswordService`. */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error(
    'DIRECT_DATABASE_URL manquante. Le seed doit utiliser le rôle propriétaire ' +
      '(il écrit dans plusieurs tenants), pas le rôle applicatif soumis à la RLS.',
  );
}

const prisma = new PrismaClient({ datasourceUrl: directUrl });

const chf = (v: string | number) => new Prisma.Decimal(v);

/**
 * Dépose une pièce de démonstration : le fichier ET sa fiche.
 *
 * Le seed écrit vraiment sur le support de développement (`STOCKAGE_LOCAL_DIR`),
 * en reproduisant la convention de clé de `apps/api/src/stockage/chemin.ts` :
 * une fiche sans pièce donnerait une GED dont le téléchargement échoue, ce qui
 * est pire qu'une GED vide.
 */
async function deposerDocumentDeDemo(
  societeId: number,
  operationId: number,
  document: {
    titre: string;
    categorie: 'PLAN' | 'CONTRAT' | 'PV_SEANCE';
    fileName: string;
    contenu: string;
    lotId?: number;
    contratId?: number;
    seanceId?: number;
  },
): Promise<void> {
  const cle = `societes/${societeId}/operations/${operationId}/2026/${randomUUID()}-${document.fileName}`;
  const chemin = resolve(process.env.STOCKAGE_LOCAL_DIR ?? './var/documents', cle);
  await mkdir(dirname(chemin), { recursive: true });
  await writeFile(chemin, document.contenu, 'utf8');

  await prisma.document.create({
    data: {
      societeId,
      operationId,
      titre: document.titre,
      categorie: document.categorie,
      fileName: document.fileName,
      filePath: cle,
      mimeType: 'text/markdown',
      fileSize: Buffer.byteLength(document.contenu, 'utf8'),
      lotId: document.lotId ?? null,
      contratId: document.contratId ?? null,
      seanceId: document.seanceId ?? null,
    },
  });
}

// =====================================================================
//  Remise à zéro
// =====================================================================

async function reset(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // RESTART IDENTITY : les identifiants redeviennent déterministes (société 1, 2),
  // ce sur quoi s'appuient l'écran de vérification et les tests.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`→ ${tables.length} tables vidées`);
}

// =====================================================================
//  Arborescence CFC
// =====================================================================

interface CfcSpec {
  code: string;
  libelle: string;
  enfants?: CfcSpec[];
}

const CFC: CfcSpec[] = [
  {
    code: '0',
    libelle: 'Terrain',
    enfants: [
      { code: '01', libelle: 'Achat du terrain' },
      { code: '02', libelle: "Frais d'acquisition (notaire, droits de mutation)" },
    ],
  },
  {
    code: '1',
    libelle: 'Travaux préparatoires',
    enfants: [
      { code: '11', libelle: 'Déblaiement, préparation du terrain' },
      { code: '13', libelle: 'Installations de chantier communes' },
    ],
  },
  {
    code: '2',
    libelle: 'Bâtiment',
    enfants: [
      { code: '20', libelle: 'Excavation' },
      {
        code: '21',
        libelle: 'Gros œuvre 1',
        enfants: [{ code: '211', libelle: 'Travaux de maçonnerie et béton armé' }],
      },
      {
        code: '22',
        libelle: 'Gros œuvre 2',
        enfants: [
          { code: '221', libelle: 'Fenêtres et portes extérieures' },
          { code: '224', libelle: 'Couverture et étanchéité' },
        ],
      },
      {
        code: '23',
        libelle: 'Installations électriques',
        enfants: [
          {
            code: '232',
            libelle: 'Installations à courant fort',
            enfants: [{ code: '232.1', libelle: 'Courant fort — travaux' }],
          },
        ],
      },
      { code: '24', libelle: 'Chauffage, ventilation, conditionnement' },
      { code: '25', libelle: 'Installations sanitaires' },
      {
        code: '27',
        libelle: 'Aménagements intérieurs 1',
        enfants: [
          {
            code: '271',
            libelle: 'Plâtrerie',
            enfants: [{ code: '271.0', libelle: 'Plâtrerie — travaux' }],
          },
        ],
      },
      {
        code: '28',
        libelle: 'Aménagements intérieurs 2',
        enfants: [{ code: '281', libelle: 'Revêtements de sol' }],
      },
    ],
  },
  { code: '4', libelle: 'Aménagements extérieurs' },
  {
    code: '5',
    libelle: 'Frais secondaires et comptes d’attente',
    enfants: [
      { code: '51', libelle: 'Autorisations, taxes, émoluments' },
      { code: '56', libelle: 'Intérêts intercalaires du crédit de construction' },
      { code: '59', libelle: 'Réserve pour imprévus' },
    ],
  },
];

/** Insère l'arbre CFC et renvoie une table code → id. */
async function creerCfc(operationId: number, specs: CfcSpec[]): Promise<Map<string, number>> {
  const parCode = new Map<string, number>();

  const inserer = async (spec: CfcSpec, parentId: number | null, niveau: number, ordre: number) => {
    const node = await prisma.cfcNode.create({
      data: { operationId, parentId, code: spec.code, libelle: spec.libelle, niveau, ordre },
    });
    parCode.set(spec.code, node.id);
    let i = 0;
    for (const enfant of spec.enfants ?? []) {
      await inserer(enfant, node.id, niveau + 1, i++);
    }
  };

  let i = 0;
  for (const spec of specs) {
    await inserer(spec, null, 1, i++);
  }
  return parCode;
}

// =====================================================================
//  Lots — Immeuble A (12) + Immeuble B (8) = 20 lots PPE
// =====================================================================

interface LotSpec {
  reference: string;
  etage: number;
  pieces: string;
  surface: string;
  prix: string;
  parking: { type: 'BOX' | 'INTERIEURE' | 'COUVERTE'; prix: string; reference: string };
}

const LOTS_A: LotSpec[] = [
  {
    reference: 'A01',
    etage: 0,
    pieces: '3.5',
    surface: '84.50',
    prix: '680000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A01' },
  },
  // Lot de référence du prototype : 815 000 + box 35 000 = 850 000 (prix total acte).
  {
    reference: 'A02',
    etage: 0,
    pieces: '4.5',
    surface: '102.00',
    prix: '815000',
    parking: { type: 'BOX', prix: '35000', reference: 'BOX-A02' },
  },
  {
    reference: 'A03',
    etage: 1,
    pieces: '4.5',
    surface: '104.50',
    prix: '835000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A03' },
  },
  {
    reference: 'A04',
    etage: 1,
    pieces: '2.5',
    surface: '61.00',
    prix: '495000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A04' },
  },
  {
    reference: 'A05',
    etage: 1,
    pieces: '3.5',
    surface: '86.00',
    prix: '695000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A05' },
  },
  {
    reference: 'A06',
    etage: 2,
    pieces: '4.5',
    surface: '103.00',
    prix: '825000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A06' },
  },
  {
    reference: 'A07',
    etage: 2,
    pieces: '5.5',
    surface: '128.50',
    prix: '1045000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A07' },
  },
  {
    reference: 'A08',
    etage: 2,
    pieces: '2.5',
    surface: '62.50',
    prix: '510000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A08' },
  },
  {
    reference: 'A09',
    etage: 3,
    pieces: '3.5',
    surface: '85.00',
    prix: '690000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A09' },
  },
  {
    reference: 'A10',
    etage: 3,
    pieces: '4.5',
    surface: '105.00',
    prix: '845000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A10' },
  },
  {
    reference: 'A11',
    etage: 4,
    pieces: '5.5',
    surface: '131.00',
    prix: '1075000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A11' },
  },
  {
    reference: 'A12',
    etage: 4,
    pieces: '4.5',
    surface: '106.50',
    prix: '860000',
    parking: { type: 'INTERIEURE', prix: '30000', reference: 'P-A12' },
  },
];

const LOTS_B: LotSpec[] = [
  {
    reference: 'B01',
    etage: 0,
    pieces: '3.5',
    surface: '82.00',
    prix: '655000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B01' },
  },
  {
    reference: 'B02',
    etage: 0,
    pieces: '4.5',
    surface: '100.50',
    prix: '800000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B02' },
  },
  {
    reference: 'B03',
    etage: 1,
    pieces: '2.5',
    surface: '60.00',
    prix: '485000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B03' },
  },
  {
    reference: 'B04',
    etage: 1,
    pieces: '4.5',
    surface: '101.50',
    prix: '810000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B04' },
  },
  {
    reference: 'B05',
    etage: 2,
    pieces: '3.5',
    surface: '83.50',
    prix: '670000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B05' },
  },
  {
    reference: 'B06',
    etage: 2,
    pieces: '5.5',
    surface: '126.00',
    prix: '1015000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B06' },
  },
  {
    reference: 'B07',
    etage: 3,
    pieces: '4.5',
    surface: '102.50',
    prix: '820000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B07' },
  },
  {
    reference: 'B08',
    etage: 3,
    pieces: '3.5',
    surface: '84.00',
    prix: '680000',
    parking: { type: 'COUVERTE', prix: '22000', reference: 'P-B08' },
  },
];

/**
 * Millièmes PPE au prorata de la surface, ajustés pour que la somme fasse
 * exactement `totalMillemes` (invariant : Σ quotes-parts = totalMillemes).
 */
function calculerMillemes(lots: LotSpec[], totalMillemes: number): Prisma.Decimal[] {
  const surfaces = lots.map((l) => new Prisma.Decimal(l.surface));
  const surfaceTotale = surfaces.reduce((a, s) => a.plus(s), new Prisma.Decimal(0));

  const parts = surfaces.map((s) =>
    s.dividedBy(surfaceTotale).times(totalMillemes).toDecimalPlaces(3),
  );
  const somme = parts.reduce((a, p) => a.plus(p), new Prisma.Decimal(0));
  const ecart = new Prisma.Decimal(totalMillemes).minus(somme);

  // L'écart d'arrondi est absorbé par le dernier lot : la somme est exacte.
  const dernier = parts.length - 1;
  parts[dernier] = parts[dernier]!.plus(ecart);
  return parts;
}

// =====================================================================
//  Tenant 1 — Probat Promotions SA
// =====================================================================

async function seedProbat(): Promise<void> {
  const societe = await prisma.societe.create({
    data: {
      raisonSociale: 'Probat Promotions SA',
      formeJuridique: 'SA',
      ide: 'CHE-114.223.987',
      numeroTva: 'CHE-114.223.987 TVA',
      adresse: 'Avenue de la Gare 12',
      codePostal: '1003',
      localite: 'Lausanne',
      canton: 'VD',
      email: 'contact@probat.ch',
      telephone: '+41 21 555 10 10',
      // QR-IBAN (identifiant d'institution 30000–31999) : c'est LUI qui rend
      // la référence QR à 27 chiffres utilisable. Avec un IBAN ordinaire, la
      // QR-facture part sans référence structurée et le rapprochement
      // bancaire redevient manuel — cf. `qr-facture.ts`.
      iban: 'CH57 3000 0123 4567 8901 2',
      profil: 'PROMOTEUR',
      // Un promoteur active tout : chantier + surcouche commercialisation.
      modulesActifs: [
        'FONCIER',
        'BUDGET_CFC',
        'SOUMISSIONS',
        'ADJUDICATIONS',
        'CONTRATS',
        'FACTURES',
        'SUIVI_CHANTIER',
        'ECARTS',
        'SEANCES',
        'GED',
        'ACTEURS',
        'LOTS',
        'ACQUEREURS',
        'BILAN_PROMOTEUR',
        'ECHEANCIER',
        'APPELS_FONDS',
        'TRESORERIE',
        'COURTAGE',
      ],
      actionnaires: {
        create: [
          { nom: 'Christophe Bonjour', partPct: chf('60.00'), fonction: 'Administrateur' },
          { nom: 'Fondation Léman Invest', partPct: chf('40.00'), fonction: 'Actionnaire' },
        ],
      },
    },
  });

  // --- Annuaire des acteurs -------------------------------------------
  const notaire = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'NOTAIRE',
      societeNom: 'Étude Rochat & Associés',
      nom: 'Rochat',
      prenom: 'Anne',
      adresse: 'Place Saint-François 8',
      codePostal: '1003',
      localite: 'Lausanne',
      email: 'a.rochat@etude-rochat.ch',
    },
  });

  const architecte = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'ARCHITECTE',
      societeNom: 'Atelier Vertigo Architectes Sàrl',
      nom: 'Perret',
      prenom: 'Julien',
      localite: 'Lausanne',
      email: 'j.perret@vertigo-archi.ch',
    },
  });

  const geometre = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'GEOMETRE',
      societeNom: 'Bureau Cadastra SA',
      localite: 'Renens',
      email: 'info@cadastra.ch',
    },
  });

  // L'EG intervient sur l'opération : elle existe ici comme ACTEUR du tenant
  // Probat, et par ailleurs comme Societe à part entière (tenant 2).
  const acteurEg = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'ENTREPRISE_GENERALE',
      societeNom: 'Constructa Entreprise Générale SA',
      nom: 'Girard',
      prenom: 'Marc',
      localite: 'Bussigny',
      email: 'm.girard@constructa.ch',
    },
  });

  // --- Opération ------------------------------------------------------
  const operation = await prisma.operation.create({
    data: {
      societeId: societe.id,
      nom: 'Les Jardins de Prilly',
      description:
        'Deux immeubles en PPE, 20 lots, sur les parcelles 2841 et 2842. Vente sur plan.',
      commune: 'Prilly',
      canton: 'VD',
      parcelle: '2841, 2842',
      statut: 'EN_CHANTIER',
      dateDebut: new Date('2026-03-02'),
      dateLivraisonPrevue: new Date('2027-11-30'),
      prixTerrain: chf('3200000'),
      fraisNotaireTerrain: chf('58000'),
      droitsMutation: chf('105600'),
      terrainAvecBatiment: false,
      modeRealisation: 'CORPS_DETAT_SEPARES',
      notaireActeurId: notaire.id,
      commercialisationActive: true,
      // Rattachement à la promotion Kolabimo : c'est cette clé que les
      // webhooks entrants portent, et sans elle un événement est « hors
      // périmètre » plutôt qu'en erreur.
      kolabimoPromotionId: 4201,
      operationActeurs: {
        create: [
          {
            acteurId: architecte.id,
            role: 'ARCHITECTE',
            estMandataireGeneral: false,
            montantMandat: chf('890000'),
            ordre: 0,
          },
          { acteurId: notaire.id, role: 'NOTAIRE', ordre: 1 },
          { acteurId: geometre.id, role: 'GEOMETRE', montantMandat: chf('42000'), ordre: 2 },
          { acteurId: acteurEg.id, role: 'ENTREPRISE_GENERALE', suitLeProjet: true, ordre: 3 },
        ],
      },
      parcelles: {
        create: [
          {
            numero: '2841',
            egrid: 'CH807361283946',
            commune: 'Prilly',
            surfaceM2: chf('2480.00'),
            affectationZone: 'Zone de moyenne densité',
            registreFoncier: 'RF Lausanne',
          },
          {
            numero: '2842',
            egrid: 'CH807361283947',
            commune: 'Prilly',
            surfaceM2: chf('1910.00'),
            affectationZone: 'Zone de moyenne densité',
            registreFoncier: 'RF Lausanne',
          },
        ],
      },
    },
  });

  // --- Clé d'API de la passerelle Kolabimo -----------------------------
  // Elle identifie le tenant d'un webhook entrant ET sert de secret de
  // signature. Valeur de développement, au même titre que le mot de passe des
  // comptes du seed : à régénérer avant toute mise en ligne.
  await prisma.apiKey.create({
    data: {
      societeId: societe.id,
      key: CLE_API_PROBAT,
      label: 'Kolabimo — Les Jardins de Prilly',
    },
  });

  // --- Biens et lots ---------------------------------------------------
  const immeubleA = await prisma.bien.create({
    data: {
      operationId: operation.id,
      nature: 'IMMEUBLE',
      nom: 'Immeuble A',
      nbEtages: 5,
      description: '12 lots PPE, attique en 4e',
    },
  });
  const immeubleB = await prisma.bien.create({
    data: {
      operationId: operation.id,
      nature: 'IMMEUBLE',
      nom: 'Immeuble B',
      nbEtages: 4,
      description: '8 lots PPE',
    },
  });

  const tousLots = [...LOTS_A, ...LOTS_B];
  const millemes = calculerMillemes(tousLots, 1000);

  const lotsCrees = new Map<string, number>();
  for (const [index, spec] of tousLots.entries()) {
    const bienId = index < LOTS_A.length ? immeubleA.id : immeubleB.id;
    const lot = await prisma.lot.create({
      data: {
        bienId,
        reference: spec.reference,
        etage: spec.etage,
        nombrePieces: chf(spec.pieces),
        surfaceM2: chf(spec.surface),
        quotePartPPE: millemes[index]!,
        prixVente: chf(spec.prix),
        statut: 'DISPONIBLE',
        // Correspondance Kolabimo, dérivée de l'index pour rester stable d'un
        // reseed à l'autre : A02 est toujours l'appartement 4302.
        kolabimoAppartementId: 4300 + index,
        parkings: {
          create: [
            {
              reference: spec.parking.reference,
              type: spec.parking.type,
              prix: chf(spec.parking.prix),
              kolabimoParkingId: 4500 + index,
              ordre: 0,
            },
          ],
        },
      },
    });
    lotsCrees.set(spec.reference, lot.id);
  }

  await prisma.ppe.create({
    data: {
      operationId: operation.id,
      bienId: immeubleA.id,
      numero: 'PPE-2841-A',
      dateActeConstitutif: new Date('2026-01-20'),
      notaireActeurId: notaire.id,
      totalMillemes: 1000,
      note: 'Millièmes au prorata des surfaces pondérées des 20 lots (immeubles A et B).',
    },
  });

  // --- CFC et budget ---------------------------------------------------
  const cfc = await creerCfc(operation.id, CFC);

  const budget = await prisma.budgetVersion.create({
    data: {
      operationId: operation.id,
      libelle: 'Budget initial',
      statut: 'VALIDE',
      isCourant: true,
      commentaire: 'Budget validé au bouclement du financement, janvier 2026.',
    },
  });

  const lignes: { code: string; designation: string; montant: string; reserve?: boolean }[] = [
    { code: '01', designation: 'Achat du terrain (parcelles 2841 + 2842)', montant: '3200000' },
    { code: '02', designation: 'Notaire, droits de mutation, RF, cédule', montant: '190000' },
    { code: '11', designation: 'Déblaiement et préparation du terrain', montant: '120000' },
    { code: '13', designation: 'Installations de chantier communes', montant: '180000' },
    { code: '20', designation: 'Excavation et évacuation', montant: '420000' },
    { code: '211', designation: 'Maçonnerie et béton armé — deux immeubles', montant: '3100000' },
    { code: '221', designation: 'Fenêtres bois-métal et portes extérieures', montant: '620000' },
    { code: '224', designation: 'Couverture et étanchéité toitures', montant: '380000' },
    { code: '232.1', designation: 'Installations à courant fort', montant: '540000' },
    { code: '24', designation: 'Chauffage PAC, ventilation double flux', montant: '780000' },
    { code: '25', designation: 'Installations sanitaires', montant: '460000' },
    { code: '271.0', designation: 'Plâtrerie et peinture', montant: '390000' },
    { code: '281', designation: 'Revêtements de sol (parquet, carrelage)', montant: '520000' },
    { code: '4', designation: 'Aménagements extérieurs et plantations', montant: '340000' },
    { code: '51', designation: 'Autorisations, taxes, émoluments', montant: '210000' },
    { code: '56', designation: 'Intérêts intercalaires crédit de construction', montant: '280000' },
    {
      code: '59',
      designation: 'Provision pour imprévus (3,7 %)',
      montant: '450000',
      reserve: true,
    },
  ];

  for (const ligne of lignes) {
    const cfcNodeId = cfc.get(ligne.code);
    if (!cfcNodeId) throw new Error(`Poste CFC ${ligne.code} absent de l'arbre`);
    await prisma.ligneBudget.create({
      data: {
        budgetVersionId: budget.id,
        cfcNodeId,
        designation: ligne.designation,
        montant: chf(ligne.montant),
        tvaPct: chf('8.10'),
        estReserve: ligne.reserve ?? false,
      },
    });
  }

  // --- Entreprises, soumissions et adjudication -----------------------
  // Deux soumissions volontairement à des stades différents : l'une adjugée
  // avec son contrat — elle alimente les colonnes « adjugé » et « commandé »
  // du budget CFC — l'autre encore en comparaison, pour que l'écran de
  // comparaison des offres ait une vraie décision à présenter.
  const entreprises = await Promise.all(
    [
      {
        nom: 'Plâtrerie Dubois SA',
        corpsMetier: 'Plâtrerie',
        contactNom: 'Michel Dubois',
        email: 'contact@platrerie-dubois.ch',
        localite: 'Renens',
      },
      {
        nom: 'Peinture Sanchez Sàrl',
        corpsMetier: 'Plâtrerie',
        contactNom: 'Ana Sanchez',
        email: 'info@sanchez-peinture.ch',
      },
      {
        nom: 'Atelier Blanc SA',
        corpsMetier: 'Plâtrerie',
        contactNom: 'Yves Blanc',
        email: 'devis@atelier-blanc.ch',
      },
      {
        nom: 'Rossier Électricité SA',
        corpsMetier: 'Électricité',
        contactNom: 'Pierre Rossier',
        email: 'p.rossier@rossier-elec.ch',
      },
      {
        nom: 'Currat Installations SA',
        corpsMetier: 'Électricité',
        contactNom: 'Léa Currat',
        email: 'offres@currat.ch',
      },
      {
        nom: 'Elektro Vaud SA',
        corpsMetier: 'Électricité',
        contactNom: 'Hans Meier',
        email: 'kontakt@elektro-vaud.ch',
      },
    ].map(({ localite: _localite, ...data }) =>
      prisma.entreprise.create({ data: { societeId: societe.id, ...data } }),
    ),
  );
  const parNom = (nom: string) => entreprises.find((e) => e.nom === nom)!;

  // Soumission 1 — adjugée, avec contrat. Le prototype référence
  // « Contrat SIA 118 · Plâtrerie Dubois » : c'est celle-ci.
  const soumissionPlatrerie = await prisma.soumission.create({
    data: {
      operationId: operation.id,
      cfcNodeId: cfc.get('271.0')!,
      intitule: 'Plâtrerie et peinture — immeubles A et B',
      corpsMetier: 'Plâtrerie',
      statut: 'ADJUGEE',
      dateEnvoi: new Date('2026-05-04'),
      dateLimite: new Date('2026-06-02'),
    },
  });

  const offresPlatrerie = await Promise.all(
    [
      {
        entreprise: 'Plâtrerie Dubois SA',
        montant: '372500',
        remise: null,
        statut: 'RETENUE' as const,
        reception: '2026-05-28',
      },
      {
        entreprise: 'Peinture Sanchez Sàrl',
        montant: '398000',
        remise: null,
        statut: 'ECARTEE' as const,
        reception: '2026-05-30',
      },
      {
        entreprise: 'Atelier Blanc SA',
        montant: '415000',
        remise: null,
        statut: 'ECARTEE' as const,
        reception: '2026-06-01',
      },
    ].map((o) =>
      prisma.offre.create({
        data: {
          soumissionId: soumissionPlatrerie.id,
          entrepriseId: parNom(o.entreprise).id,
          montant: chf(o.montant),
          remisePct: o.remise ? chf(o.remise) : null,
          statut: o.statut,
          dateReception: new Date(o.reception),
        },
      }),
    ),
  );

  for (const offre of offresPlatrerie) {
    await prisma.soumissionInvitation.create({
      data: {
        soumissionId: soumissionPlatrerie.id,
        entrepriseId: offre.entrepriseId,
        dateEnvoi: new Date('2026-05-04'),
        aRepondu: true,
      },
    });
  }

  const adjudicationPlatrerie = await prisma.adjudication.create({
    data: {
      soumissionId: soumissionPlatrerie.id,
      offreId: offresPlatrerie[0]!.id,
      montantAdjuge: chf('372500'),
      dateDecision: new Date('2026-06-10'),
      commentaire: 'Moins-disant, références solides sur des PPE comparables.',
    },
  });

  const contratPlatrerie = await prisma.contrat.create({
    data: {
      operationId: operation.id,
      entrepriseId: parNom('Plâtrerie Dubois SA').id,
      cfcNodeId: cfc.get('271.0')!,
      adjudicationId: adjudicationPlatrerie.id,
      reference: 'C-2026-014',
      montant: chf('372500'),
      retenueGarantiePct: chf('10.00'),
      statut: 'EN_COURS',
      dateSignature: new Date('2026-06-18'),
    },
  });

  // Soumission 2 — en comparaison. Currat est plus cher au brut mais
  // moins-disant net grâce à sa remise : c'est ce que l'écran doit montrer.
  const soumissionElec = await prisma.soumission.create({
    data: {
      operationId: operation.id,
      cfcNodeId: cfc.get('232.1')!,
      intitule: 'Installations à courant fort',
      corpsMetier: 'Électricité',
      statut: 'EN_COMPARAISON',
      dateEnvoi: new Date('2026-06-15'),
      dateLimite: new Date('2026-07-20'),
    },
  });

  for (const o of [
    {
      entreprise: 'Rossier Électricité SA',
      montant: '498000',
      remise: null,
      reception: '2026-07-14',
    },
    {
      entreprise: 'Currat Installations SA',
      montant: '505000',
      remise: '2.00',
      reception: '2026-07-17',
    },
    { entreprise: 'Elektro Vaud SA', montant: '551900', remise: null, reception: '2026-07-18' },
  ]) {
    await prisma.soumissionInvitation.create({
      data: {
        soumissionId: soumissionElec.id,
        entrepriseId: parNom(o.entreprise).id,
        dateEnvoi: new Date('2026-06-15'),
        aRepondu: true,
      },
    });
    await prisma.offre.create({
      data: {
        soumissionId: soumissionElec.id,
        entrepriseId: parNom(o.entreprise).id,
        montant: chf(o.montant),
        remisePct: o.remise ? chf(o.remise) : null,
        statut: 'RECUE',
        dateReception: new Date(o.reception),
      },
    });
  }

  // --- Factures fournisseurs -------------------------------------------
  // Une facture validée et payée — elle alimente les colonnes « facturé » et
  // « payé » du fil rouge — et une seconde tout juste reçue, avec son texte,
  // pour que l'analyse et la proposition d'imputation aient de quoi tourner.
  const factureSituation1 = await prisma.facture.create({
    data: {
      societeId: societe.id,
      operationId: operation.id,
      contratId: contratPlatrerie.id,
      entrepriseId: parNom('Plâtrerie Dubois SA').id,
      cfcNodeId: cfc.get('271.0')!,
      type: 'SITUATION',
      statut: 'VALIDEE',
      numero: '2026-0417',
      dateFacture: new Date('2026-07-31'),
      montantHT: chf('145000'),
      tvaPct: chf('8.10'),
      montantTTC: chf('156745'),
      ocrStatut: 'TRAITEE',
      cfcSuggereId: cfc.get('271.0')!,
      ocrConfiance: chf('98.00'),
      dateValidation: new Date('2026-08-05'),
    },
  });

  await prisma.paiementFournisseur.create({
    data: {
      factureId: factureSituation1.id,
      montant: chf('156745'),
      dateValeur: new Date('2026-08-12'),
      moyen: 'virement',
      reference: '21 00000 00000 00000 00417 30001',
    },
  });

  await prisma.facture.create({
    data: {
      societeId: societe.id,
      operationId: operation.id,
      type: 'SITUATION',
      statut: 'RECUE',
      fichierUrl: 'demo://factures/2026-0603.pdf',
      // Texte tel qu'un extracteur PDF le produirait. Le rapprochement CFC,
      // lui, est calculé par Prometis : c'est la moitié qui nous appartient.
      ocrTexte: [
        'Plâtrerie Dubois SA',
        'Route de Renens 44 — 1020 Renens',
        '',
        'Facture n° : 2026-0603',
        'Date de facture : 30.09.2026',
        'Chantier : Les Jardins de Prilly — contrat C-2026-014',
        '',
        'Situation n° 2 — plâtrerie et peinture, immeuble A',
        'Total HT : 98’000.00',
        'TVA 8.10 % : 7’938.00',
        'Total TTC : 105’938.00',
        '',
        'Référence : 21 00000 00000 00000 00603 10001',
      ].join('\n'),
    },
  });

  // --- Échéancier des appels de fonds ---------------------------------
  // Σ des pourcentages non nuls = 100 %. La dernière étape est un jalon de
  // suivi de chantier SANS pourcentage : elle ne génère aucun appel de fonds.
  const etapes: {
    ordre: number;
    libelle: string;
    pct: string | null;
    statut: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
    completion?: string;
    prevue?: string;
  }[] = [
    {
      ordre: 1,
      libelle: "Signature de l'acte de vente",
      pct: '5.00',
      statut: 'COMPLETED',
      completion: '2026-04-15',
    },
    {
      ordre: 2,
      libelle: 'Terrassement et fondations',
      pct: '15.00',
      statut: 'COMPLETED',
      completion: '2026-06-30',
    },
    {
      ordre: 3,
      libelle: 'Gros œuvre achevé',
      pct: '25.00',
      statut: 'IN_PROGRESS',
      prevue: '2026-11-28',
    },
    {
      ordre: 4,
      libelle: "Hors d'eau / hors d'air",
      pct: '20.00',
      statut: 'NOT_STARTED',
      prevue: '2027-02-26',
    },
    {
      ordre: 5,
      libelle: 'Second œuvre et installations techniques',
      pct: '20.00',
      statut: 'NOT_STARTED',
      prevue: '2027-06-30',
    },
    { ordre: 6, libelle: 'Finitions', pct: '10.00', statut: 'NOT_STARTED', prevue: '2027-10-29' },
    {
      ordre: 7,
      libelle: 'Remise des clés',
      pct: '5.00',
      statut: 'NOT_STARTED',
      prevue: '2027-11-30',
    },
    {
      ordre: 8,
      libelle: "Réception de l'ouvrage (SIA 118)",
      pct: null,
      statut: 'NOT_STARTED',
      prevue: '2027-12-15',
    },
  ];

  const etapesCreees = new Map<number, number>();
  for (const e of etapes) {
    const etape = await prisma.echeancierEtape.create({
      data: {
        operationId: operation.id,
        ordre: e.ordre,
        libelle: e.libelle,
        pourcentage: e.pct === null ? null : chf(e.pct),
        statut: e.statut,
        dateCompletion: e.completion ? new Date(e.completion) : null,
        datePrevue: e.prevue ? new Date(e.prevue) : null,
      },
    });
    etapesCreees.set(e.ordre, etape.id);
  }

  // --- Ventes ---------------------------------------------------------
  const acquereurMeylan = await prisma.acquereur.create({
    data: {
      societeId: societe.id,
      nom: 'Meylan',
      prenom: 'Sophie',
      email: 'sophie.meylan@example.ch',
      telephone: '+41 79 412 88 03',
      adresse: 'Chemin des Vignes 4, 1010 Lausanne',
    },
  });

  const acquereurDaSilva = await prisma.acquereur.create({
    data: {
      societeId: societe.id,
      nom: 'Da Silva',
      prenom: 'Paulo',
      email: 'paulo.dasilva@example.ch',
      telephone: '+41 78 220 14 55',
    },
  });

  // Lot A02 : prix total acte = 815 000 (lot) + 35 000 (box) = 850 000.
  // Le montant est FIGÉ dans la réservation : le prix du lot pourra bouger,
  // l'acte non.
  const prixTotalActeA02 = chf('815000').plus(chf('35000'));

  const reservationA02 = await prisma.reservation.create({
    data: {
      operationId: operation.id,
      lotId: lotsCrees.get('A02')!,
      acquereurId: acquereurMeylan.id,
      statut: 'FONDS_VERSES',
      prixTotalActe: prixTotalActeA02,
      dateReservation: new Date('2026-02-10'),
      dateSignatureActe: new Date('2026-04-15'),
      notaireActeurId: notaire.id,
      externalId: 'kolabimo-res-A02-2026',
    },
  });
  await prisma.lot.update({ where: { id: lotsCrees.get('A02')! }, data: { statut: 'VENDU' } });

  await prisma.reservation.create({
    data: {
      operationId: operation.id,
      lotId: lotsCrees.get('A05')!,
      acquereurId: acquereurDaSilva.id,
      statut: 'RESERVE',
      prixTotalActe: chf('695000').plus(chf('30000')),
      dateReservation: new Date('2026-05-22'),
      externalId: 'kolabimo-res-A05-2026',
    },
  });
  await prisma.lot.update({ where: { id: lotsCrees.get('A05')! }, data: { statut: 'RESERVE' } });

  // Appels de fonds des deux étapes terminées, pour la réservation A02.
  // 5 % de 850 000 = 42 500 · 15 % de 850 000 = 127 500.
  const appels: {
    ordre: number;
    pct: string;
    numero: string;
    statut: 'PAYE' | 'ENVOYE';
    emission: string;
    echeance: string;
  }[] = [
    {
      ordre: 1,
      pct: '5.00',
      numero: 'AF-2026-0001',
      statut: 'PAYE',
      emission: '2026-04-16',
      echeance: '2026-04-30',
    },
    {
      ordre: 2,
      pct: '15.00',
      numero: 'AF-2026-0014',
      statut: 'ENVOYE',
      emission: '2026-07-01',
      echeance: '2026-07-31',
    },
  ];

  for (const a of appels) {
    const montant = prixTotalActeA02.times(chf(a.pct)).dividedBy(100).toDecimalPlaces(2);
    const appel = await prisma.appelDeFonds.create({
      data: {
        reservationId: reservationA02.id,
        etapeId: etapesCreees.get(a.ordre)!,
        numero: a.numero,
        pourcentage: chf(a.pct),
        montant,
        statut: a.statut,
        dateEmission: new Date(a.emission),
        dateEnvoi: new Date(a.emission),
        dateEcheance: new Date(a.echeance),
        // Référence QR produite par la MÊME fonction que le moteur : 27
        // chiffres avec la clé de contrôle du modulo 10 récursif.
        //
        // Elle était auparavant recopiée du prototype, à titre illustratif —
        // sa clé de contrôle était donc fausse, et la QR-facture générée à
        // partir d'elle aurait été rejetée par la banque de l'acquéreur.
        qrReference: genererReferenceQR(
          operation.id,
          reservationA02.id,
          etapesCreees.get(a.ordre)!,
        ),
      },
    });

    if (a.statut === 'PAYE') {
      await prisma.encaissement.create({
        data: {
          appelDeFondsId: appel.id,
          montant,
          dateValeur: new Date('2026-04-28'),
          reference: appel.qrReference,
          source: 'camt.054',
          confirmeParId: null,
          dateConfirmation: new Date('2026-04-28'),
        },
      });
    }
  }

  // --- Courtage --------------------------------------------------------
  // Un mandat exclusif à 3 % sur le prix hors taxe. Sur le lot A02 vendu
  // 850 000, la commission due est donc de 25 500 — le chiffre que l'écran
  // Courtage doit afficher.
  const courtier = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'COURTIER',
      societeNom: 'Régie Lémanique SA',
      nom: 'Perret',
      prenom: 'Sandrine',
      localite: 'Lausanne',
      email: 's.perret@regie-lemanique.ch',
      telephone: '+41 21 555 44 33',
    },
  });

  const mandat = await prisma.mandatCourtage.create({
    data: {
      operationId: operation.id,
      courtierActeurId: courtier.id,
      commissionType: 'POURCENTAGE',
      commissionPct: chf('3'),
      assietteTtc: false,
      perimetre: 'TOUTE_OPERATION',
      exclusif: true,
      dateSignature: new Date('2026-01-15'),
      statut: 'ACTIF',
      notes: 'Commercialisation des 20 lots PPE. Exclusivité jusqu’à la livraison.',
    },
  });

  await prisma.commissionCourtage.create({
    data: {
      mandatCourtageId: mandat.id,
      reservationId: reservationA02.id,
      montant: prixTotalActeA02.times(3).dividedBy(100),
      statut: 'DUE',
      dateDue: new Date('2026-05-15'),
      note: '3.00 % de 850000.00 CHF (prix total acte hors taxe)',
    },
  });

  // --- Séance de chantier et points de suivi ---------------------------
  const seance = await prisma.seance.create({
    data: {
      societeId: societe.id,
      operationId: operation.id,
      type: 'CHANTIER',
      numero: 'Chantier #12',
      titre: 'Séance de chantier hebdomadaire',
      statut: 'TENUE',
      date: new Date('2026-08-05'),
      lieu: 'Prilly, bureau de chantier',
      ordreDuJour: 'Avancement gros œuvre · étanchéité toiture · choix des revêtements.',
      participants: {
        create: [
          { nom: 'Julie Favre', organisation: 'Probat Promotions SA', present: true },
          {
            acteurId: architecte.id,
            nom: 'Léa Berger',
            organisation: 'Atelier Berger',
            present: true,
          },
          {
            acteurId: acteurEg.id,
            nom: 'Marc Girard',
            organisation: 'Constructa EG SA',
            present: false,
          },
        ],
      },
      points: {
        create: [
          {
            ordre: 1,
            titre: 'Étanchéité de la toiture',
            contenu: 'Reprise du relevé en angle nord-est avant la pose des ferblanteries.',
            responsable: 'Currat SA',
            // Échéance dépassée : c'est le point qui doit ressortir « en
            // retard » dans la vue des actions ouvertes.
            echeance: new Date('2026-08-12'),
            statut: 'OUVERT',
          },
          {
            ordre: 2,
            titre: 'Choix des revêtements de sol',
            contenu: 'Trois échantillons présentés ; arbitrage attendu du promoteur.',
            responsable: 'Probat',
            echeance: new Date('2026-09-30'),
            statut: 'EN_COURS',
          },
          {
            ordre: 3,
            titre: 'Raccordement provisoire du chantier',
            contenu: 'Effectué le 2 août, conforme.',
            statut: 'CLOS',
          },
        ],
      },
    },
  });

  // --- GED : deux pièces, fichier compris ------------------------------
  // Le stockage local est le transport de développement : le seed y écrit
  // vraiment, sinon l'écran afficherait des fiches sans pièce et le
  // téléchargement échouerait.
  await deposerDocumentDeDemo(societe.id, operation.id, {
    titre: 'Plan du rez — Immeuble A',
    categorie: 'PLAN',
    fileName: 'plan-rez-immeuble-a.md',
    lotId: lotsCrees.get('A02')!,
    contenu:
      '# Plan du rez — Immeuble A\n\n' +
      'Pièce de démonstration. Un vrai plan serait ici un PDF ou un DWG.\n',
  });

  await deposerDocumentDeDemo(societe.id, operation.id, {
    titre: 'Contrat de plâtrerie C-2026-014',
    categorie: 'CONTRAT',
    fileName: 'contrat-c-2026-014.md',
    contratId: contratPlatrerie.id,
    contenu:
      '# Contrat C-2026-014 — Plâtrerie\n\n' +
      'Entreprise : Currat SA · Montant : 372 500 CHF HT · SIA 118.\n',
  });

  await deposerDocumentDeDemo(societe.id, operation.id, {
    titre: 'PV — Chantier #12',
    categorie: 'PV_SEANCE',
    fileName: 'pv-chantier-12.md',
    seanceId: seance.id,
    contenu:
      '# Chantier #12 — Séance de chantier hebdomadaire\n\n' +
      'Procès-verbal de démonstration. Le régénérer depuis l’écran Séances\n' +
      'produira une version 2 rédigée par l’application.\n',
  });

  // --- Comptes et droits ----------------------------------------------
  const empreinte = await hash(MOT_DE_PASSE_DEV, ARGON2);

  const compteChristophe = await prisma.compte.create({
    data: {
      email: 'christophe@probat.ch',
      passwordHash: empreinte,
      prenom: 'Christophe',
      nom: 'Bonjour',
    },
  });
  const compteJulie = await prisma.compte.create({
    data: {
      email: 'julie@probat.ch',
      passwordHash: empreinte,
      prenom: 'Julie',
      nom: 'Favre',
    },
  });
  // Marc appartient à DEUX sociétés : c'est le cas d'usage du sélecteur
  // d'espace de travail, et le témoin du test de bascule.
  const compteMarc = await prisma.compte.create({
    data: {
      email: 'm.girard@constructa.ch',
      passwordHash: empreinte,
      prenom: 'Marc',
      nom: 'Girard',
    },
  });

  await prisma.membership.create({
    data: {
      compteId: compteChristophe.id,
      societeId: societe.id,
      role: 'OWNER',
      fonction: 'Administrateur délégué',
    },
  });
  // Julie n'est pas administratrice : sans `OperationAccess`, elle ne verrait
  // aucune opération. On lui confie celle-ci — c'est le chemin non-admin, et
  // il doit être exerçable.
  const membershipJulie = await prisma.membership.create({
    data: {
      compteId: compteJulie.id,
      societeId: societe.id,
      role: 'CHEF_PROJET',
      fonction: 'Cheffe de projet',
    },
  });
  // Membre EXTERNE chez Probat, rattaché à son acteur : accès scopé.
  const membershipMarcChezProbat = await prisma.membership.create({
    data: {
      compteId: compteMarc.id,
      societeId: societe.id,
      role: 'EXTERNE',
      acteurId: acteurEg.id,
    },
  });

  await prisma.operationAccess.create({
    data: {
      operationId: operation.id,
      membershipId: membershipJulie.id,
      accessLevel: 'MANAGE',
      modules: [], // vide = tout ce que le niveau permet
    },
  });

  await prisma.operationAccess.create({
    data: {
      operationId: operation.id,
      membershipId: membershipMarcChezProbat.id,
      accessLevel: 'OPERATE',
      // Restriction fine : l'EG saisit les soumissions et les contrats,
      // elle ne voit ni les ventes ni les appels de fonds.
      modules: ['SOUMISSIONS', 'CONTRATS', 'DOCUMENTS'],
    },
  });

  await prisma.auditLog.create({
    data: {
      societeId: societe.id,
      action: 'seed.demonstration',
      entite: 'Operation',
      entiteId: operation.id,
      donnees: { operation: operation.nom, lots: tousLots.length, source: 'prisma/seed.ts' },
    },
  });

  console.log(`→ Tenant ${societe.id} · ${societe.raisonSociale}`);
  console.log(
    `   opération « ${operation.nom} » · ${tousLots.length} lots · ${cfc.size} postes CFC`,
  );
  console.log(`   lot A02 : prix total acte ${prixTotalActeA02.toFixed(2)} CHF`);
  console.log(
    `   ${entreprises.length} entreprises · 2 soumissions (1 adjugée à 372 500, 1 en comparaison)`,
  );
  console.log('   2 factures : 145 000 validée et payée, 98 000 reçue avec son texte à analyser');
}

// =====================================================================
//  Tenant 2 — Constructa EG SA (témoin d'isolation)
// =====================================================================

async function seedConstructa(): Promise<void> {
  const societe = await prisma.societe.create({
    data: {
      raisonSociale: 'Constructa Entreprise Générale SA',
      formeJuridique: 'SA',
      ide: 'CHE-201.884.335',
      adresse: 'Route de Crissier 30',
      codePostal: '1030',
      localite: 'Bussigny',
      canton: 'VD',
      email: 'contact@constructa.ch',
      profil: 'ENTREPRISE_GENERALE',
      // Une EG n'active QUE la gestion de chantier : ni lots, ni acquéreurs,
      // ni appels de fonds. Pas de « simulation » de promoteur.
      modulesActifs: [
        'FONCIER',
        'BUDGET_CFC',
        'SOUMISSIONS',
        'ADJUDICATIONS',
        'CONTRATS',
        'FACTURES',
        'SUIVI_CHANTIER',
        'ECARTS',
        'SEANCES',
        'GED',
        'ACTEURS',
      ],
    },
  });

  const maitreOuvrage = await prisma.acteur.create({
    data: {
      societeId: societe.id,
      type: 'MAITRE_OUVRAGE',
      societeNom: 'Fondation Immobilière du Lac',
      localite: 'Morges',
      email: 'gestion@fil-morges.ch',
    },
  });

  const operation = await prisma.operation.create({
    data: {
      societeId: societe.id,
      nom: 'Résidence du Lac',
      description:
        "Chantier piloté en entreprise générale pour un maître d'ouvrage tiers. Pas de commercialisation dans Prometis.",
      commune: 'Morges',
      canton: 'VD',
      parcelle: '1187',
      statut: 'EN_CHANTIER',
      dateDebut: new Date('2026-05-04'),
      dateLivraisonPrevue: new Date('2027-08-31'),
      modeRealisation: 'ENTREPRISE_GENERALE',
      maitreOuvrageActeurId: maitreOuvrage.id,
      // Le promoteur n'est pas dans l'app : aucune surcouche de vente.
      commercialisationActive: false,
      operationActeurs: {
        create: [{ acteurId: maitreOuvrage.id, role: 'MAITRE_OUVRAGE', ordre: 0 }],
      },
    },
  });

  // Le second tenant a sa propre clé : c'est elle qui permet de prouver qu'un
  // webhook signé par Constructa ne touche rien chez Probat.
  await prisma.apiKey.create({
    data: {
      societeId: societe.id,
      key: CLE_API_CONSTRUCTA,
      label: 'Kolabimo — témoin d’isolation',
    },
  });

  const bien = await prisma.bien.create({
    data: { operationId: operation.id, nature: 'IMMEUBLE', nom: 'Bâtiment unique', nbEtages: 3 },
  });

  for (const [i, spec] of [
    { reference: 'L1', surface: '78.00', prix: '640000' },
    { reference: 'L2', surface: '95.00', prix: '760000' },
    { reference: 'L3', surface: '112.00', prix: '910000' },
  ].entries()) {
    await prisma.lot.create({
      data: {
        bienId: bien.id,
        reference: spec.reference,
        etage: i,
        surfaceM2: chf(spec.surface),
        prixVente: chf(spec.prix),
      },
    });
  }

  const cfc = await creerCfc(operation.id, [
    { code: '1', libelle: 'Travaux préparatoires' },
    {
      code: '2',
      libelle: 'Bâtiment',
      enfants: [
        { code: '21', libelle: 'Gros œuvre 1', enfants: [{ code: '211', libelle: 'Maçonnerie' }] },
        { code: '24', libelle: 'Chauffage, ventilation' },
      ],
    },
    { code: '5', libelle: "Frais secondaires et comptes d'attente" },
  ]);

  const budget = await prisma.budgetVersion.create({
    data: {
      operationId: operation.id,
      libelle: 'Budget initial',
      statut: 'VALIDE',
      isCourant: true,
    },
  });

  for (const ligne of [
    { code: '1', designation: 'Travaux préparatoires', montant: '95000' },
    { code: '211', designation: 'Maçonnerie et béton armé', montant: '1480000' },
    { code: '24', designation: 'Chauffage et ventilation', montant: '310000' },
    { code: '5', designation: 'Frais secondaires', montant: '140000' },
  ]) {
    await prisma.ligneBudget.create({
      data: {
        budgetVersionId: budget.id,
        cfcNodeId: cfc.get(ligne.code)!,
        designation: ligne.designation,
        montant: chf(ligne.montant),
        tvaPct: chf('8.10'),
      },
    });
  }

  // Jalons SANS pourcentage : pur suivi de chantier, aucun appel de fonds.
  // C'est le cas d'usage d'une EG, et il valide que `pourcentage` est nullable.
  for (const e of [
    { ordre: 1, libelle: 'Fondations', statut: 'COMPLETED' as const, completion: '2026-07-10' },
    { ordre: 2, libelle: 'Gros œuvre', statut: 'IN_PROGRESS' as const, prevue: '2026-12-18' },
    { ordre: 3, libelle: 'Second œuvre', statut: 'NOT_STARTED' as const, prevue: '2027-05-28' },
    {
      ordre: 4,
      libelle: "Réception de l'ouvrage",
      statut: 'NOT_STARTED' as const,
      prevue: '2027-08-31',
    },
  ]) {
    await prisma.echeancierEtape.create({
      data: {
        operationId: operation.id,
        ordre: e.ordre,
        libelle: e.libelle,
        pourcentage: null,
        statut: e.statut,
        dateCompletion: 'completion' in e && e.completion ? new Date(e.completion) : null,
        datePrevue: 'prevue' in e && e.prevue ? new Date(e.prevue) : null,
      },
    });
  }

  const compteMarc = await prisma.compte.findUniqueOrThrow({
    where: { email: 'm.girard@constructa.ch' },
  });
  await prisma.membership.create({
    data: { compteId: compteMarc.id, societeId: societe.id, role: 'OWNER', fonction: 'Directeur' },
  });

  console.log(`→ Tenant ${societe.id} · ${societe.raisonSociale}`);
  console.log(`   opération « ${operation.nom} » · commercialisation désactivée`);
}

// =====================================================================

async function main(): Promise<void> {
  console.log('Seed Prometis — rôle propriétaire (contourne la RLS)\n');
  await reset();
  await seedProbat();
  await seedConstructa();

  const societes = await prisma.societe.count();
  const operations = await prisma.operation.count();
  const lots = await prisma.lot.count();
  console.log(`\n✓ ${societes} tenants · ${operations} opérations · ${lots} lots`);
  console.log('  Le second tenant est le témoin du test d’isolation (npm run test:rls).');
  console.log(`\n  Comptes de démonstration — mot de passe : ${MOT_DE_PASSE_DEV}`);
  console.log('    christophe@probat.ch        OWNER chez Probat');
  console.log('    julie@probat.ch             CHEF_PROJET chez Probat, MANAGE sur l’opération');
  console.log('    m.girard@constructa.ch      OWNER chez Constructa ET EXTERNE chez Probat');
  console.log('                                (accès scopé : SOUMISSIONS, CONTRATS, DOCUMENTS)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
