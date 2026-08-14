/**
 * Lot 4 — Definition of Done :
 *   « d'une soumission à un contrat, la colonne "adjugé" du CFC se remplit ».
 *
 * La suite déroule la chaîne complète sur son propre terrain, puis l'efface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, PROBAT, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let operationSeed: number;
let bacASable: number | undefined;

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
    corps: { nom: 'Bac à sable adjudication — test', commune: 'Prilly' },
  });
  bacASable = creation.body.id;
});

afterAll(async () => {
  if (bacASable) await supprimerOperationDeTest(bacASable);
  await ownerDb.$disconnect();
});

// =====================================================================

describe('DoD — de la soumission au contrat, le CFC se remplit', () => {
  let cfcNodeId: number;
  let soumissionId: number;
  let offreRetenue: number;
  let adjudicationId: number;
  let contratId: number;

  it('prépare un poste CFC budgété à 200 000', async () => {
    const noeud = await appel<{ id: number }>(`/operations/${bacASable}/cfc`, {
      methode: 'POST',
      token: christophe,
      corps: { code: '285', libelle: 'Traitement des surfaces intérieures' },
    });
    cfcNodeId = noeud.body.id;

    const version = await appel<{ id: number }>(`/operations/${bacASable}/budget/versions`, {
      methode: 'POST',
      token: christophe,
      corps: { libelle: 'Budget initial' },
    });
    await appel(`/operations/${bacASable}/budget/versions/${version.body.id}/lignes`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId, montant: '200000', designation: 'Peinture intérieure' },
    });
    await appel(`/operations/${bacASable}/budget/versions/${version.body.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { statut: 'VALIDE', isCourant: true },
    });

    const vue = await appel<{ total: { budgeteRevise: string; adjuge: string } }>(
      `/operations/${bacASable}/budget`,
      { token: christophe },
    );
    expect(vue.body.total.budgeteRevise).toBe('200000');
    // Point de départ : rien n'est encore adjugé.
    expect(vue.body.total.adjuge).toBe('0');
  });

  it('consulte trois entreprises et reçoit leurs offres', async () => {
    const soumission = await appel<{ id: number }>(`/operations/${bacASable}/soumissions`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId, intitule: 'Peinture intérieure', corpsMetier: 'Peinture' },
    });
    expect(soumission.status).toBe(201);
    soumissionId = soumission.body.id;

    const entreprises = await appel<{ id: number; nom: string }[]>('/entreprises', {
      token: christophe,
    });
    const [a, b, c] = entreprises.body;

    for (const [entreprise, prix] of [
      [a!, '186000'],
      [b!, '178500'],
      [c!, '205000'],
    ] as const) {
      await appel(
        `/operations/${bacASable}/soumissions/${soumissionId}/invitations/${entreprise.id}`,
        {
          methode: 'POST',
          token: christophe,
          corps: {},
        },
      );
      const offre = await appel<{ id: number }>(
        `/operations/${bacASable}/soumissions/${soumissionId}/offres`,
        {
          methode: 'POST',
          token: christophe,
          corps: { entrepriseId: entreprise.id, montant: prix, statut: 'RECUE' },
        },
      );
      if (prix === '178500') offreRetenue = offre.body.id;
    }
  });

  it('compare et propose le moins-disant', async () => {
    const c = await appel<{
      moinsDisant: string;
      budgete: string;
      propositionOffreId: number;
      offres: { rang: number | null; ecartBudgetPct: string | null }[];
    }>(`/operations/${bacASable}/soumissions/${soumissionId}/comparaison`, { token: christophe });

    expect(c.status).toBe(200);
    expect(c.body.budgete).toBe('200000');
    expect(c.body.moinsDisant).toBe('178500');
    expect(c.body.propositionOffreId).toBe(offreRetenue);
  });

  it('adjuge — et la colonne « adjugé » du CFC se remplit', async () => {
    const adjudication = await appel<{ id: number; montantAdjuge: string }>(
      `/operations/${bacASable}/soumissions/${soumissionId}/adjudication`,
      { methode: 'POST', token: christophe, corps: { offreId: offreRetenue } },
    );
    expect(adjudication.status).toBe(201);
    expect(adjudication.body.montantAdjuge).toBe('178500');
    adjudicationId = adjudication.body.id;

    const vue = await appel<{ total: { adjuge: string; commande: string; resteAEngager: string } }>(
      `/operations/${bacASable}/budget`,
      { token: christophe },
    );
    expect(vue.body.total.adjuge).toBe('178500');
    // Le contrat n'existe pas encore : rien n'est commandé.
    expect(vue.body.total.commande).toBe('0');
  });

  it('bascule les statuts d’un coup : retenue et écartées', async () => {
    const c = await appel<{ offres: { id: number; statut: string }[] }>(
      `/operations/${bacASable}/soumissions/${soumissionId}/comparaison`,
      { token: christophe },
    );
    const retenues = c.body.offres.filter((o) => o.statut === 'RETENUE');
    const ecartees = c.body.offres.filter((o) => o.statut === 'ECARTEE');
    expect(retenues.map((o) => o.id)).toEqual([offreRetenue]);
    expect(ecartees).toHaveLength(2);
  });

  it('refuse une seconde adjudication sur la même soumission', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/soumissions/${soumissionId}/adjudication`,
      { methode: 'POST', token: christophe, corps: { offreId: offreRetenue } },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('déjà adjugée');
  });

  it('génère le contrat — et la colonne « commandé » se remplit', async () => {
    const contrat = await appel<{ id: number; montant: string; cfcNodeId: number }>(
      `/operations/${bacASable}/adjudications/${adjudicationId}/contrat`,
      {
        methode: 'POST',
        token: christophe,
        corps: {
          reference: 'C-TEST-001',
          retenueGarantiePct: '10.00',
          dateSignature: '2026-08-01',
        },
      },
    );
    expect(contrat.status).toBe(201);
    // Montant, entreprise et poste CFC sont repris de l'adjudication.
    expect(contrat.body.montant).toBe('178500');
    expect(contrat.body.cfcNodeId).toBe(cfcNodeId);
    contratId = contrat.body.id;

    const vue = await appel<{ total: { adjuge: string; commande: string; resteAEngager: string } }>(
      `/operations/${bacASable}/budget`,
      { token: christophe },
    );
    expect(vue.body.total.commande).toBe('178500');
    expect(vue.body.total.resteAEngager).toBe('21500'); // 200 000 − 178 500
  });

  it('un avenant en plus déplace le commandé et le reste à engager', async () => {
    const avenant = await appel(`/operations/${bacASable}/contrats/${contratId}/avenants`, {
      methode: 'POST',
      token: christophe,
      corps: { montant: '12000', motif: 'Reprise de fissures non prévues' },
    });
    expect(avenant.status).toBe(201);

    const vue = await appel<{ total: { commande: string; resteAEngager: string } }>(
      `/operations/${bacASable}/budget`,
      { token: christophe },
    );
    expect(vue.body.total.commande).toBe('190500'); // 178 500 + 12 000
    expect(vue.body.total.resteAEngager).toBe('9500');
  });

  it('un avenant en moins fonctionne aussi — le montant est signé', async () => {
    await appel(`/operations/${bacASable}/contrats/${contratId}/avenants`, {
      methode: 'POST',
      token: christophe,
      corps: { montant: '-4500', motif: 'Renonciation au traitement du sous-sol' },
    });

    const vue = await appel<{ total: { commande: string } }>(`/operations/${bacASable}/budget`, {
      token: christophe,
    });
    expect(vue.body.total.commande).toBe('186000'); // 190 500 − 4 500
  });

  it('refuse un avenant à zéro', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/contrats/${contratId}/avenants`,
      { methode: 'POST', token: christophe, corps: { montant: '0', motif: 'Rien' } },
    );
    expect(res.status).toBe(400);
  });

  it('calcule la fin du délai de garantie SIA 118 à la réception', async () => {
    const res = await appel<{ dateReception: string; finGarantie: string }>(
      `/operations/${bacASable}/contrats/${contratId}`,
      {
        methode: 'PATCH',
        token: christophe,
        corps: { statut: 'RECEPTION', dateReception: '2027-09-15' },
      },
    );
    expect(res.status).toBe(200);
    // Deux ans, calculés et non saisis.
    expect(res.body.finGarantie.slice(0, 10)).toBe('2029-09-15');
  });

  it("refuse d'annuler une adjudication dont découle un contrat", async () => {
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/adjudications/${adjudicationId}`,
      { methode: 'DELETE', token: christophe },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('contrat');
  });
});

// =====================================================================

describe('le seed illustre les deux stades', () => {
  it('la plâtrerie est adjugée et sous contrat', async () => {
    const soumissions = await appel<
      {
        id: number;
        intitule: string;
        statut: string;
        adjudication: { montantAdjuge: string; contrat: { reference: string } | null } | null;
      }[]
    >(`/operations/${operationSeed}/soumissions`, { token: christophe });

    const platrerie = soumissions.body.find((s) => s.intitule.startsWith('Plâtrerie'))!;
    expect(platrerie.statut).toBe('ADJUGEE');
    expect(platrerie.adjudication!.montantAdjuge).toBe('372500');
    expect(platrerie.adjudication!.contrat!.reference).toBe('C-2026-014');
  });

  it('le courant fort attend encore la décision', async () => {
    const soumissions = await appel<{ intitule: string; statut: string; adjudication: unknown }[]>(
      `/operations/${operationSeed}/soumissions`,
      { token: christophe },
    );
    const elec = soumissions.body.find((s) => s.intitule.includes('courant fort'))!;
    expect(elec.statut).toBe('EN_COMPARAISON');
    expect(elec.adjudication).toBeNull();
  });

  it('le fil rouge du poste plâtrerie se lit de bout en bout', async () => {
    const vue = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });

    const trouver = (n: NoeudApi, code: string): NoeudApi | undefined =>
      n.code === code ? n : n.enfants.map((e) => trouver(e, code)).find(Boolean);
    const poste = vue.body.arbre.map((n) => trouver(n, '271.0')).find(Boolean)!;

    expect(poste.total.budgeteRevise).toBe('390000');
    expect(poste.total.adjuge).toBe('372500');
    expect(poste.total.commande).toBe('372500');
    expect(poste.resteAEngager).toBe('17500');
  });

  it("l'entreprise générale externe voit les soumissions — c'est son périmètre", async () => {
    // Marc a SOUMISSIONS et CONTRATS dans son accès scopé.
    const marc = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel<unknown[]>(`/operations/${operationSeed}/soumissions`, { token: marc });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('mais ne peut pas adjuger : MANAGE requis', async () => {
    const marc = await jetonPourEspace(COMPTES.marc, PROBAT);
    const res = await appel<{ message: string }>(
      `/operations/${operationSeed}/soumissions/2/adjudication`,
      { methode: 'POST', token: marc, corps: { offreId: 4 } },
    );
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('MANAGE');
  });
});

interface NoeudApi {
  code: string;
  total: { budgeteRevise: string; adjuge: string; commande: string };
  resteAEngager: string;
  enfants: NoeudApi[];
}
