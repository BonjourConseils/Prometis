/**
 * Lot 2 — Definition of Done :
 *   « fiche opération + bilan promoteur (coûts CFC vs recettes lots+parkings
 *     → marge) ».
 *
 * Tests de bout en bout sur l'API réelle. Ils créent leurs propres données
 * pour ne pas dépendre de l'ordre d'exécution, et vérifient au passage que la
 * cohérence parent → enfant tient : la RLS garantit le bon tenant, pas la
 * bonne opération.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  COMPTES,
  CONSTRUCTA,
  PROBAT,
  apiDisponible,
  appel,
  jetonPourEspace,
} from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let marcChezConstructa: string;
let julie: string;
let operationProbat: number;

/**
 * Opérations créées par cette suite, à effacer ensuite.
 *
 * Les autres suites supposent la base dans l'état du seed. Un test qui laisse
 * ses données derrière lui ne casse pas son propre fichier — il casse les
 * suivants, et le diagnostic part alors dans la mauvaise direction.
 */
const operationsCreees: number[] = [];

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Démarrer « npm run dev:api » puis relancer.`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, PROBAT);
  marcChezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);
  julie = await jetonPourEspace(COMPTES.julie, PROBAT);

  const operations = await appel<{ id: number; nom: string }[]>('/operations', {
    token: christophe,
  });
  operationProbat = operations.body.find((o) => o.nom === 'Les Jardins de Prilly')!.id;
});

afterAll(async () => {
  // Suppression avec le rôle propriétaire : il n'existe pas de route de
  // suppression d'opération, et il ne doit pas en exister pour ce seul besoin.
  // Pas de `catch` : un nettoyage qui échoue en silence casse les fichiers
  // suivants et envoie le diagnostic dans la mauvaise direction.
  for (const id of operationsCreees) {
    await supprimerOperationDeTest(id);
  }
  await ownerDb.$disconnect();
});

// =====================================================================

describe('DoD — bilan promoteur', () => {
  it('confronte coûts CFC et recettes lots + parkings', async () => {
    const res = await appel<{
      couts: { total: string; reserves: string; parGroupeCfc: { groupe: string }[] };
      recettes: { total: string; lots: string; parkings: string; nombreLots: number };
      marge: string;
      tauxMargePct: string;
      budgetVersion: { libelle: string };
    }>(`/operations/${operationProbat}/bilan`, { token: christophe });

    expect(res.status).toBe(200);
    expect(res.body.couts.total).toBe('12180000');
    expect(res.body.couts.reserves).toBe('450000');
    expect(res.body.recettes.lots).toBe('15305000');
    expect(res.body.recettes.parkings).toBe('541000');
    expect(res.body.recettes.total).toBe('15846000');
    expect(res.body.recettes.nombreLots).toBe(20);
    expect(res.body.marge).toBe('3666000');
    expect(res.body.tauxMargePct).toBe('23.14');
  });

  it('utilise la version de budget courante, pas la somme des versions', async () => {
    const res = await appel<{ budgetVersion: { libelle: string } }>(
      `/operations/${operationProbat}/bilan`,
      { token: christophe },
    );
    expect(res.body.budgetVersion.libelle).toBe('Budget initial');
  });

  it('ventile les coûts par groupe principal CFC', async () => {
    const res = await appel<{ couts: { parGroupeCfc: { groupe: string; montant: string }[] } }>(
      `/operations/${operationProbat}/bilan`,
      { token: christophe },
    );
    const parGroupe = Object.fromEntries(
      res.body.couts.parGroupeCfc.map((g) => [g.groupe, g.montant]),
    );
    expect(parGroupe['0']).toBe('3390000'); // terrain
    expect(parGroupe['2']).toBe('7210000'); // bâtiment
  });

  it("est refusé à une entreprise générale : le module n'est pas activé", async () => {
    const operations = await appel<{ id: number }[]>('/operations', { token: marcChezConstructa });
    const res = await appel<{ message: string }>(`/operations/${operations.body[0]!.id}/bilan`, {
      token: marcChezConstructa,
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('BILAN_PROMOTEUR');
  });
});

// =====================================================================

describe('registre PPE', () => {
  it('contrôle la somme des millièmes contre la constitution', async () => {
    const res = await appel<{
      parcelles: { numero: string }[];
      biens: { nom: string; lots: unknown[]; sommeMillemes: string }[];
      controle: {
        totalMillemes: number;
        sommeMillemes: string;
        coherent: boolean;
        nombreLots: number;
      };
    }>(`/operations/${operationProbat}/registre-ppe`, { token: christophe });

    expect(res.status).toBe(200);
    expect(res.body.parcelles.map((p) => p.numero)).toEqual(['2841', '2842']);
    expect(res.body.controle.nombreLots).toBe(20);
    expect(res.body.controle.totalMillemes).toBe(1000);
    expect(res.body.controle.coherent).toBe(true);
  });

  it('la somme des millièmes des deux immeubles fait le total', async () => {
    const res = await appel<{
      biens: { nom: string; sommeMillemes: string }[];
      controle: { sommeMillemes: string };
    }>(`/operations/${operationProbat}/registre-ppe`, { token: christophe });

    const somme = res.body.biens.reduce((total, b) => total + Number(b.sommeMillemes), 0);
    expect(somme).toBeCloseTo(Number(res.body.controle.sommeMillemes), 3);
  });
});

// =====================================================================

describe('création et cadre d’une opération', () => {
  let nouvelleOperation: number;

  it('un chef de projet peut créer une opération et la voit aussitôt', async () => {
    const creation = await appel<{ id: number; nom: string }>('/operations', {
      methode: 'POST',
      token: julie,
      corps: {
        nom: 'Résidence des Vergers — test',
        commune: 'Renens',
        canton: 'VD',
        prixTerrain: '1800000',
      },
    });
    expect(creation.status).toBe(201);
    nouvelleOperation = creation.body.id;
    operationsCreees.push(nouvelleOperation);

    // Sans l'OperationAccess accordé d'office au créateur, elle serait
    // invisible pour lui : la liste est filtrée par les droits.
    const liste = await appel<{ id: number }[]>('/operations', { token: julie });
    expect(liste.body.map((o) => o.id)).toContain(nouvelleOperation);
  });

  it('accepte parcelles, biens, lots et places de parc', async () => {
    const parcelle = await appel<{ id: number }>(`/operations/${nouvelleOperation}/parcelles`, {
      methode: 'POST',
      token: julie,
      corps: { numero: '5512', commune: 'Renens', surfaceM2: '1250.50' },
    });
    expect(parcelle.status).toBe(201);

    const bien = await appel<{ id: number }>(`/operations/${nouvelleOperation}/biens`, {
      methode: 'POST',
      token: julie,
      corps: { nature: 'IMMEUBLE', nom: 'Bâtiment C', nbEtages: 3 },
    });
    expect(bien.status).toBe(201);

    const lot = await appel<{ id: number }>(
      `/operations/${nouvelleOperation}/biens/${bien.body.id}/lots`,
      {
        methode: 'POST',
        token: julie,
        corps: { reference: 'C01', etage: 0, surfaceM2: '78.50', prixVente: '640000' },
      },
    );
    expect(lot.status).toBe(201);

    const parking = await appel(`/operations/${nouvelleOperation}/lots/${lot.body.id}/parkings`, {
      methode: 'POST',
      token: julie,
      corps: { reference: 'P-C01', type: 'BOX', prix: '38000' },
    });
    expect(parking.status).toBe(201);

    // Le bilan doit refléter immédiatement lot + parking.
    const bilan = await appel<{ recettes: { total: string } }>(
      `/operations/${nouvelleOperation}/bilan`,
      { token: julie },
    );
    expect(bilan.body.recettes.total).toBe('678000');
  });

  it('refuse une référence de lot en double dans le même bien', async () => {
    const biens = await appel<{ id: number }[]>(`/operations/${nouvelleOperation}/biens`, {
      token: julie,
    });
    const res = await appel<{ message: string }>(
      `/operations/${nouvelleOperation}/biens/${biens.body[0]!.id}/lots`,
      { methode: 'POST', token: julie, corps: { reference: 'C01' } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('C01');
  });

  it('refuse un prix de vente négatif', async () => {
    const biens = await appel<{ id: number }[]>(`/operations/${nouvelleOperation}/biens`, {
      token: julie,
    });
    const res = await appel(`/operations/${nouvelleOperation}/biens/${biens.body[0]!.id}/lots`, {
      methode: 'POST',
      token: julie,
      corps: { reference: 'C99', prixVente: '-1000' },
    });
    expect(res.status).toBe(400);
  });

  it("ne laisse pas modifier un lot d'une AUTRE opération du même tenant", async () => {
    // La RLS ne dit rien ici : les deux opérations appartiennent à Probat.
    // C'est le contrôle de cohérence parent → enfant qui doit refuser.
    const biens = await appel<{ id: number; lots: { id: number }[] }[]>(
      `/operations/${operationProbat}/biens`,
      { token: christophe },
    );
    const lotDeLAutreOperation = biens.body[0]!.lots[0]!.id;

    const res = await appel<{ message: string }>(
      `/operations/${nouvelleOperation}/lots/${lotDeLAutreOperation}`,
      { methode: 'PATCH', token: julie, corps: { etage: 9 } },
    );
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('introuvable dans cette opération');
  });
});

// =====================================================================

describe('prix figé après signature de l’acte', () => {
  it('refuse de modifier le prix d’un lot vendu', async () => {
    const biens = await appel<{ lots: { id: number; reference: string }[] }[]>(
      `/operations/${operationProbat}/biens`,
      { token: christophe },
    );
    const a02 = biens.body.flatMap((b) => b.lots).find((l) => l.reference === 'A02')!;

    const res = await appel<{ message: string }>(`/operations/${operationProbat}/lots/${a02.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { prixVente: '900000' },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('acte signé');
  });

  it('mais laisse modifier les autres champs du même lot', async () => {
    const biens = await appel<{ lots: { id: number; reference: string }[] }[]>(
      `/operations/${operationProbat}/biens`,
      { token: christophe },
    );
    const a02 = biens.body.flatMap((b) => b.lots).find((l) => l.reference === 'A02')!;

    const res = await appel(`/operations/${operationProbat}/lots/${a02.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { etage: 0 },
    });
    expect(res.status).toBe(200);
  });
});

// =====================================================================

describe('annuaire des acteurs', () => {
  it("liste l'équipe de l'opération avec les rôles", async () => {
    const res = await appel<{ role: string; acteur: { societeNom: string } }[]>(
      `/operations/${operationProbat}/acteurs`,
      { token: christophe },
    );

    expect(res.status).toBe(200);
    const roles = res.body.map((r) => r.role);
    expect(roles).toContain('NOTAIRE');
    expect(roles).toContain('ARCHITECTE');
    expect(roles).toContain('ENTREPRISE_GENERALE');
  });

  it("l'annuaire est au niveau de la société, pas de l'opération", async () => {
    const res = await appel<{ id: number; type: string }[]>('/acteurs', { token: christophe });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
  });

  it('filtre par type', async () => {
    const res = await appel<{ type: string }[]>('/acteurs?type=NOTAIRE', { token: christophe });
    expect(res.body.every((a) => a.type === 'NOTAIRE')).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('refuse un deuxième mandataire général sur la même opération', async () => {
    const acteurs = await appel<{ id: number; type: string }[]>('/acteurs', { token: christophe });
    const architecte = acteurs.body.find((a) => a.type === 'ARCHITECTE')!;
    const geometre = acteurs.body.find((a) => a.type === 'GEOMETRE')!;

    const premier = await appel(`/operations/${operationProbat}/acteurs/${architecte.id}`, {
      methode: 'POST',
      token: christophe,
      corps: { role: 'ARCHITECTE', estMandataireGeneral: true },
    });
    expect(premier.status).toBe(201);

    const second = await appel<{ message: string }>(
      `/operations/${operationProbat}/acteurs/${geometre.id}`,
      {
        methode: 'POST',
        token: christophe,
        corps: { role: 'GEOMETRE', estMandataireGeneral: true },
      },
    );
    expect(second.status).toBe(400);
    expect(second.body.message).toContain('mandataire général');

    // On repose l'état pour ne pas polluer les exécutions suivantes.
    await appel(`/operations/${operationProbat}/acteurs/${architecte.id}`, {
      methode: 'POST',
      token: christophe,
      corps: { role: 'ARCHITECTE', estMandataireGeneral: false },
    });
  });
});

// =====================================================================

describe('accès scopé par module sur le foncier', () => {
  it("l'entreprise générale externe n'atteint pas le foncier de Probat", async () => {
    // Marc a OPERATE sur l'opération, mais son accès est restreint à
    // SOUMISSIONS, CONTRATS et DOCUMENTS.
    const marcChezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel<{ message: string }>(`/operations/${operationProbat}/parcelles`, {
      token: marcChezProbat,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('FONCIER');
  });

  it('ni les lots', async () => {
    const marcChezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel(`/operations/${operationProbat}/registre-ppe`, {
      token: marcChezProbat,
    });
    expect(res.status).toBe(403);
  });
});
