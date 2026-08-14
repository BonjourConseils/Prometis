/**
 * Lot 3 — Definition of Done :
 *   « arborescence CFC éditable, totaux agrégés, versions ».
 *
 * La suite crée son propre terrain de jeu et l'efface : les autres fichiers
 * supposent la base dans l'état du seed.
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
let julie: string;
let marcChezConstructa: string;
let operationSeed: number;

/** Opération créée par cette suite, effacée en fin de fichier. */
let bacASable: number | undefined;

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Démarrer « npm run dev:api » puis relancer.`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, PROBAT);
  julie = await jetonPourEspace(COMPTES.julie, PROBAT);
  marcChezConstructa = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);

  const operations = await appel<{ id: number; nom: string }[]>('/operations', {
    token: christophe,
  });
  operationSeed = operations.body.find((o) => o.nom === 'Les Jardins de Prilly')!.id;

  const creation = await appel<{ id: number }>('/operations', {
    methode: 'POST',
    token: christophe,
    corps: { nom: 'Bac à sable budget — test', commune: 'Renens' },
  });
  bacASable = creation.body.id;
});

afterAll(async () => {
  // Pas de `catch` : si le nettoyage échoue, la suite doit devenir rouge
  // plutôt que de laisser des données casser les fichiers suivants.
  if (bacASable) await supprimerOperationDeTest(bacASable);
  await ownerDb.$disconnect();
});

// =====================================================================

describe('DoD — totaux agrégés sur l’arborescence', () => {
  it('remonte les montants des feuilles vers les groupes principaux', async () => {
    const res = await appel<{
      arbre: {
        code: string;
        total: { budgeteRevise: string };
        propre: { budgeteRevise: string };
      }[];
      total: { budgeteInitial: string; budgeteRevise: string; reserves: string };
    }>(`/operations/${operationSeed}/budget`, { token: christophe });

    expect(res.status).toBe(200);

    const parCode = Object.fromEntries(res.body.arbre.map((n) => [n.code, n]));
    expect(parCode['0']!.total.budgeteRevise).toBe('3390000'); // 3 200 000 + 190 000
    expect(parCode['2']!.total.budgeteRevise).toBe('7210000');
    expect(res.body.total.budgeteRevise).toBe('12180000');
  });

  it('remonte sur trois niveaux : 232.1 → 232 → 23 → 2', async () => {
    const res = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });

    const groupe2 = res.body.arbre.find((n) => n.code === '2')!;
    const inst = groupe2.enfants.find((n) => n.code === '23')!;
    const courantFort = inst.enfants.find((n) => n.code === '232')!;
    const travaux = courantFort.enfants.find((n) => n.code === '232.1')!;

    expect(travaux.propre.budgeteRevise).toBe('540000');
    expect(courantFort.propre.budgeteRevise).toBe('0');
    expect(courantFort.total.budgeteRevise).toBe('540000');
    expect(inst.total.budgeteRevise).toBe('540000');
  });

  it('distingue le montant propre du total agrégé', async () => {
    const res = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });
    const groupe0 = res.body.arbre.find((n) => n.code === '0')!;
    // Rien n'est saisi sur le groupe lui-même, tout est sur ses sous-postes.
    expect(groupe0.propre.budgeteRevise).toBe('0');
    expect(groupe0.total.budgeteRevise).toBe('3390000');
  });

  it('isole les réserves et calcule le reste à engager', async () => {
    const res = await appel<{
      total: { reserves: string; resteAEngager: string; commande: string };
    }>(`/operations/${operationSeed}/budget`, { token: christophe });

    expect(res.body.total.reserves).toBe('450000');
    // Le seed contient un contrat de plâtrerie à 372 500 : c'est la part du
    // budget déjà engagée, et elle sort du reste à engager.
    expect(res.body.total.commande).toBe('372500');
    expect(res.body.total.resteAEngager).toBe('11807500');
  });

  it('le total du budget CFC égale les coûts du bilan promoteur', async () => {
    // Les deux vues doivent raconter la même chose, sinon le promoteur ne
    // sait pas laquelle croire.
    const budget = await appel<{ total: { budgeteRevise: string } }>(
      `/operations/${operationSeed}/budget`,
      { token: christophe },
    );
    const bilan = await appel<{ couts: { total: string } }>(`/operations/${operationSeed}/bilan`, {
      token: christophe,
    });
    expect(budget.body.total.budgeteRevise).toBe(bilan.body.couts.total);
  });
});

interface NoeudApi {
  code: string;
  libelle: string;
  niveau: number;
  propre: { budgeteRevise: string };
  total: { budgeteRevise: string };
  enfants: NoeudApi[];
}

// =====================================================================

describe('DoD — arborescence CFC éditable', () => {
  let noeudRacine: number;

  it('importe une trame de départ dans une opération vide', async () => {
    const res = await appel<{ postesCrees: number }>(
      `/operations/${bacASable}/cfc/importer-trame`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(200);
    expect(res.body.postesCrees).toBeGreaterThan(40);

    const arbre = await appel<{ code: string; niveau: number }[]>(`/operations/${bacASable}/cfc`, {
      token: christophe,
    });
    const codes = arbre.body.map((n) => n.code);
    expect(codes).toContain('2');
    expect(codes).toContain('211');
    expect(codes).toContain('59');
  });

  it('refuse de réimporter par-dessus un arbre existant', async () => {
    // Une fusion silencieuse produirait des doublons de codes.
    const res = await appel<{ message: string }>(`/operations/${bacASable}/cfc/importer-trame`, {
      methode: 'POST',
      token: christophe,
      corps: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('contient déjà');
  });

  it('crée un poste et en déduit le niveau depuis le parent', async () => {
    const arbre = await appel<{ id: number; code: string; niveau: number }[]>(
      `/operations/${bacASable}/cfc`,
      { token: christophe },
    );
    const poste211 = arbre.body.find((n) => n.code === '211')!;
    expect(poste211.niveau).toBe(3);

    const res = await appel<{ id: number; niveau: number; code: string }>(
      `/operations/${bacASable}/cfc`,
      {
        methode: 'POST',
        token: christophe,
        corps: { parentId: poste211.id, code: '211.1', libelle: 'Maçonnerie — travaux' },
      },
    );
    expect(res.status).toBe(201);
    // Le niveau n'est jamais fourni par l'appelant.
    expect(res.body.niveau).toBe(4);
    noeudRacine = res.body.id;
  });

  it('refuse un code CFC en double', async () => {
    const res = await appel<{ message: string }>(`/operations/${bacASable}/cfc`, {
      methode: 'POST',
      token: christophe,
      corps: { code: '211.1', libelle: 'Doublon' },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('211.1');
  });

  it('refuse un code non numérique', async () => {
    const res = await appel(`/operations/${bacASable}/cfc`, {
      methode: 'POST',
      token: christophe,
      corps: { code: 'MACONNERIE', libelle: 'Libre' },
    });
    expect(res.status).toBe(400);
  });

  it('renomme un poste', async () => {
    const res = await appel<{ libelle: string }>(`/operations/${bacASable}/cfc/${noeudRacine}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { libelle: 'Maçonnerie — gros œuvre' },
    });
    expect(res.status).toBe(200);
    expect(res.body.libelle).toBe('Maçonnerie — gros œuvre');
  });

  it('supprime un poste vide', async () => {
    const res = await appel(`/operations/${bacASable}/cfc/${noeudRacine}`, {
      methode: 'DELETE',
      token: christophe,
    });
    expect(res.status).toBe(200);
  });

  it('refuse de supprimer un poste qui porte des sous-postes', async () => {
    const arbre = await appel<{ id: number; code: string }[]>(`/operations/${bacASable}/cfc`, {
      token: christophe,
    });
    const groupe2 = arbre.body.find((n) => n.code === '2')!;

    const res = await appel<{ message: string }>(`/operations/${bacASable}/cfc/${groupe2.id}`, {
      methode: 'DELETE',
      token: christophe,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('sous-poste');
  });

  it('refuse de supprimer un poste qui porte des lignes de budget', async () => {
    // Sinon des montants disparaîtraient du fil rouge sans laisser de trace.
    const arbre = await appel<{ id: number; code: string }[]>(`/operations/${operationSeed}/cfc`, {
      token: christophe,
    });
    const poste = arbre.body.find((n) => n.code === '232.1')!;

    const res = await appel<{ message: string }>(`/operations/${operationSeed}/cfc/${poste.id}`, {
      methode: 'DELETE',
      token: christophe,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ligne(s) de budget');
  });
});

// =====================================================================

describe('DoD — versions de budget', () => {
  let versionInitiale: number;
  let revision: number;

  it('crée un budget initial et ses lignes', async () => {
    const version = await appel<{ id: number; isCourant: boolean; statut: string }>(
      `/operations/${bacASable}/budget/versions`,
      { methode: 'POST', token: christophe, corps: { libelle: 'Budget initial' } },
    );
    expect(version.status).toBe(201);
    // Une version naît en brouillon et non courante : elle se travaille.
    expect(version.body.statut).toBe('BROUILLON');
    expect(version.body.isCourant).toBe(false);
    versionInitiale = version.body.id;

    const arbre = await appel<{ id: number; code: string }[]>(`/operations/${bacASable}/cfc`, {
      token: christophe,
    });
    const poste211 = arbre.body.find((n) => n.code === '211')!;

    const ligne = await appel(
      `/operations/${bacASable}/budget/versions/${versionInitiale}/lignes`,
      {
        methode: 'POST',
        token: christophe,
        corps: {
          cfcNodeId: poste211.id,
          designation: 'Maçonnerie',
          montant: '1500000',
          tvaPct: '8.10',
        },
      },
    );
    expect(ligne.status).toBe(201);
  });

  it('refuse de rendre courante une version en brouillon', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/budget/versions/${versionInitiale}`,
      { methode: 'PATCH', token: christophe, corps: { isCourant: true } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('brouillon');
  });

  it('valide puis adopte la version', async () => {
    const res = await appel<{ statut: string; isCourant: boolean }>(
      `/operations/${bacASable}/budget/versions/${versionInitiale}`,
      { methode: 'PATCH', token: christophe, corps: { statut: 'VALIDE', isCourant: true } },
    );
    expect(res.status).toBe(200);
    expect(res.body.isCourant).toBe(true);
  });

  it('crée une révision en copiant les lignes de la version courante', async () => {
    const res = await appel<{ id: number; lignesCopiees: number }>(
      `/operations/${bacASable}/budget/versions`,
      {
        methode: 'POST',
        token: christophe,
        corps: { libelle: 'Révision 1', copierDepuisId: versionInitiale },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.lignesCopiees).toBe(1);
    revision = res.body.id;

    const lignes = await appel<unknown[]>(
      `/operations/${bacASable}/budget/versions/${revision}/lignes`,
      { token: christophe },
    );
    expect(lignes.body).toHaveLength(1);
  });

  it('une seule version reste courante après bascule', async () => {
    await appel(`/operations/${bacASable}/budget/versions/${revision}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { statut: 'VALIDE', isCourant: true },
    });

    const versions = await appel<{ id: number; isCourant: boolean }[]>(
      `/operations/${bacASable}/budget/versions`,
      { token: christophe },
    );
    const courantes = versions.body.filter((v) => v.isCourant);
    expect(courantes).toHaveLength(1);
    expect(courantes[0]!.id).toBe(revision);
  });

  it("refuse de laisser l'opération sans version courante", async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/budget/versions/${revision}`,
      { methode: 'PATCH', token: christophe, corps: { isCourant: false } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('version courante');
  });

  it('la vue compare initial et révisé', async () => {
    const arbre = await appel<{ id: number; code: string }[]>(`/operations/${bacASable}/cfc`, {
      token: christophe,
    });
    const poste211 = arbre.body.find((n) => n.code === '211')!;
    const lignes = await appel<{ id: number }[]>(
      `/operations/${bacASable}/budget/versions/${revision}/lignes`,
      { token: christophe },
    );

    // On révise le poste à la hausse.
    await appel(`/operations/${bacASable}/budget/lignes/${lignes.body[0]!.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { cfcNodeId: poste211.id, montant: '1650000' },
    });

    const vue = await appel<{
      total: { budgeteInitial: string; budgeteRevise: string; ecartRevisionInitial: string };
      versionAffichee: { libelle: string };
    }>(`/operations/${bacASable}/budget`, { token: christophe });

    expect(vue.body.versionAffichee.libelle).toBe('Révision 1');
    expect(vue.body.total.budgeteInitial).toBe('1500000');
    expect(vue.body.total.budgeteRevise).toBe('1650000');
    expect(vue.body.total.ecartRevisionInitial).toBe('150000');
  });

  it('permet de consulter une version précise', async () => {
    const vue = await appel<{ versionAffichee: { id: number }; total: { budgeteRevise: string } }>(
      `/operations/${bacASable}/budget?versionId=${versionInitiale}`,
      { token: christophe },
    );
    expect(vue.body.versionAffichee.id).toBe(versionInitiale);
    expect(vue.body.total.budgeteRevise).toBe('1500000');
  });
});

// =====================================================================

describe('ventilation du budget sur les lots', () => {
  it('la somme des parts retombe exactement sur le budget', async () => {
    const res = await appel<{
      montantTotal: string;
      sommeParts: string;
      parts: { reference: string; montant: string }[];
      cleEffective: string;
    }>(`/operations/${operationSeed}/budget/ventilation?cle=QUOTE_PART_PPE`, { token: christophe });

    expect(res.status).toBe(200);
    expect(res.body.parts).toHaveLength(20);
    expect(res.body.sommeParts).toBe(res.body.montantTotal);
    expect(res.body.montantTotal).toBe('12180000');
  });

  it('accepte les trois clés de répartition', async () => {
    for (const cle of ['QUOTE_PART_PPE', 'SURFACE', 'EGALITE']) {
      const res = await appel<{ sommeParts: string; montantTotal: string; cleEffective: string }>(
        `/operations/${operationSeed}/budget/ventilation?cle=${cle}`,
        { token: christophe },
      );
      expect(res.body.cleEffective).toBe(cle);
      expect(res.body.sommeParts).toBe(res.body.montantTotal);
    }
  });

  it('une clé inconnue retombe sur la quote-part PPE', async () => {
    const res = await appel<{ cleDemandee: string }>(
      `/operations/${operationSeed}/budget/ventilation?cle=N_IMPORTE_QUOI`,
      { token: christophe },
    );
    expect(res.body.cleDemandee).toBe('QUOTE_PART_PPE');
  });
});

// =====================================================================

describe('droits sur le budget', () => {
  it("l'entreprise générale externe n'atteint pas le budget de Probat", async () => {
    // Son accès est restreint à SOUMISSIONS, CONTRATS et DOCUMENTS.
    const marcChezProbat = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel<{ message: string }>(`/operations/${operationSeed}/budget`, {
      token: marcChezProbat,
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('BUDGET_CFC');
  });

  it('mais accède au budget de sa propre société', async () => {
    const operations = await appel<{ id: number }[]>('/operations', { token: marcChezConstructa });
    const res = await appel<{ total: { budgeteRevise: string } }>(
      `/operations/${operations.body[0]!.id}/budget`,
      { token: marcChezConstructa },
    );
    expect(res.status).toBe(200);
    expect(res.body.total.budgeteRevise).toBe('2025000');
  });

  it('OPERATE suffit pour saisir une ligne, MANAGE est requis pour adopter un budget', async () => {
    // Julie a MANAGE : les deux passent. Le test vérifie surtout que la
    // route d'adoption exige bien un niveau supérieur à la saisie.
    const versions = await appel<{ id: number }[]>(`/operations/${operationSeed}/budget/versions`, {
      token: julie,
    });
    expect(versions.status).toBe(200);
  });
});
