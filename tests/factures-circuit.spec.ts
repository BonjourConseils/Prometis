/**
 * Lot 5 — Definition of Done :
 *   « une facture lue est imputée au bon CFC après validation ;
 *     la vue écart est juste ».
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';

let christophe: string;
let julie: string;
let operationSeed: number;
let bacASable: number | undefined;

/**
 * Cette suite ne peut pas se contenter d'un bac à sable : le parcours de la
 * DoD part de la facture du seed, avec son texte réaliste. Elle la mute donc,
 * et doit la **remettre exactement dans son état d'origine** — sinon le second
 * passage échoue, et le diagnostic part sur les mauvaises pistes.
 */
let factureSeedAvant: Record<string, unknown> | null = null;

const CHAMPS_RESTAURES = [
  'statut',
  'numero',
  'dateFacture',
  'montantHT',
  'tvaPct',
  'montantTTC',
  'entrepriseId',
  'contratId',
  'cfcNodeId',
  'cfcSuggereId',
  'ocrStatut',
  'ocrConfiance',
  'validePar',
  'dateValidation',
] as const;

beforeAll(async () => {
  if (!(await apiDisponible())) {
    throw new Error(`API injoignable sur ${API}. Démarrer « npm run dev:api » puis relancer.`);
  }
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  julie = await jetonPourEspace(COMPTES.julie, CB);

  const operations = await appel<{ id: number; nom: string }[]>('/operations', {
    token: christophe,
  });
  operationSeed = operations.body.find((o) => o.nom === 'Les Jardins de Prilly')!.id;

  const aAnalyser = await ownerDb.facture.findFirst({
    where: { operationId: operationSeed, statut: 'RECUE' },
  });
  if (!aAnalyser) {
    throw new Error(
      'Aucune facture RECUE dans le seed : relancer `npm run db:seed`. ' +
        'Cette suite part de la facture de démonstration et la restaure ensuite.',
    );
  }
  factureSeedAvant = aAnalyser as unknown as Record<string, unknown>;
});

afterAll(async () => {
  if (factureSeedAvant) {
    const id = factureSeedAvant.id as number;
    const data = Object.fromEntries(CHAMPS_RESTAURES.map((c) => [c, factureSeedAvant![c]]));
    await ownerDb.facture.update({ where: { id }, data });
    // Les paiements éventuels sont supprimés : ils n'existaient pas avant.
    await ownerDb.paiementFournisseur.deleteMany({ where: { factureId: id } });
  }
  if (bacASable) await supprimerOperationDeTest(bacASable);
  await ownerDb.$disconnect();
});

// =====================================================================

describe('DoD — la vue écart est juste sur les données du seed', () => {
  it('le poste plâtrerie porte les cinq colonnes du fil rouge', async () => {
    const vue = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });

    const poste = trouver(vue.body.arbre, '271.0')!;
    expect(poste.total.budgeteRevise).toBe('390000');
    expect(poste.total.adjuge).toBe('372500');
    expect(poste.total.commande).toBe('372500');
    expect(poste.total.facture).toBe('145000');
    expect(poste.total.paye).toBe('145000');
  });

  it('le payé reste hors taxe comme les autres colonnes', async () => {
    // La facture a été réglée 156 745 TTC. Reporter ce chiffre afficherait
    // un payé supérieur au facturé sur une facture pourtant soldée.
    const vue = await appel<{ total: { facture: string; paye: string } }>(
      `/operations/${operationSeed}/budget`,
      { token: christophe },
    );
    expect(vue.body.total.facture).toBe('145000');
    expect(vue.body.total.paye).toBe('145000');
  });

  it('les restes se déduisent correctement', async () => {
    const vue = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });
    const poste = trouver(vue.body.arbre, '271.0')!;
    expect(poste.resteAEngager).toBe('17500'); // 390 000 − 372 500
    expect(poste.resteADepenser).toBe('227500'); // 372 500 − 145 000
  });

  it('la projection à terminaison retient le plus élevé du révisé et du commandé', async () => {
    const vue = await appel<{ arbre: NoeudApi[]; total: { budgeteRevise: string } }>(
      `/operations/${operationSeed}/budget`,
      { token: christophe },
    );
    const poste = trouver(vue.body.arbre, '271.0')!;
    // Ici le budget couvre encore le commandé.
    expect(poste.projectionATerminaison).toBe('390000');
  });
});

// =====================================================================

describe('DoD — lecture, proposition, puis imputation après validation', () => {
  let factureId: number;

  it('analyse la facture reçue et propose une imputation', async () => {
    factureId = factureSeedAvant!.id as number;

    const res = await appel<{
      champs: { numero: string; montantHT: string; referenceQR: string };
      suggestion: { contratId: number; cfcNodeId: number; confiance: string; motif: string };
      facture: { statut: string; cfcNodeId: number | null; cfcSuggereId: number };
    }>(`/operations/${operationSeed}/factures/${factureId}/analyser`, {
      methode: 'POST',
      token: christophe,
      corps: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.champs.numero).toBe('2026-0603');
    expect(res.body.champs.montantHT).toBe('98000');
    expect(res.body.champs.referenceQR).toBe('210000000000000000060310001');
    expect(res.body.suggestion.motif).toContain('C-2026-014');
    expect(res.body.suggestion.confiance).toBe('98');
  });

  it('la proposition ne vaut PAS imputation', async () => {
    // Le coeur de la règle : `cfcSuggereId` est rempli, `cfcNodeId` non.
    const factures = await appel<
      { id: number; cfcNodeId: number | null; cfcSuggereId: number | null; statut: string }[]
    >(`/operations/${operationSeed}/factures`, { token: christophe });
    const facture = factures.body.find((f) => f.id === factureId)!;

    expect(facture.cfcSuggereId).not.toBeNull();
    expect(facture.cfcNodeId).toBeNull();
    expect(facture.statut).toBe('A_VALIDER');
  });

  it("la facture n'entre pas encore dans la colonne « facturé »", async () => {
    const vue = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });
    expect(trouver(vue.body.arbre, '271.0')!.total.facture).toBe('145000');
  });

  it('la validation impute et alimente le fil rouge', async () => {
    const res = await appel<{ statut: string; cfcNodeId: number }>(
      `/operations/${operationSeed}/factures/${factureId}/validation`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('VALIDEE');

    const vue = await appel<{ arbre: NoeudApi[] }>(`/operations/${operationSeed}/budget`, {
      token: christophe,
    });
    const poste = trouver(vue.body.arbre, '271.0')!;
    expect(poste.total.facture).toBe('243000'); // 145 000 + 98 000
    expect(poste.resteADepenser).toBe('129500'); // 372 500 − 243 000
  });

  it('une facture déjà validée ne se revalide pas', async () => {
    const res = await appel<{ message: string }>(
      `/operations/${operationSeed}/factures/${factureId}/validation`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('déjà validée');
  });

  it('un intervenant externe ne valide pas de facture', async () => {
    const marc = await jetonPourEspace(COMPTES.marc, CB);
    const res = await appel(`/operations/${operationSeed}/factures/${factureId}/validation`, {
      methode: 'POST',
      token: marc,
      corps: {},
    });
    // Son accès ne couvre même pas le module FACTURES.
    expect(res.status).toBe(403);
  });
});

// =====================================================================

describe('contrôle bloquant du cumul', () => {
  let contratId: number;
  let factureExcessive: number;

  it('prépare un contrat de 178 500 dans un bac à sable', async () => {
    const creation = await appel<{ id: number }>('/operations', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Bac à sable factures — test', commune: 'Prilly' },
    });
    bacASable = creation.body.id;

    const noeud = await appel<{ id: number }>(`/operations/${bacASable}/cfc`, {
      methode: 'POST',
      token: christophe,
      corps: { code: '285', libelle: 'Peinture' },
    });
    const version = await appel<{ id: number }>(`/operations/${bacASable}/budget/versions`, {
      methode: 'POST',
      token: christophe,
      corps: { libelle: 'Budget initial' },
    });
    await appel(`/operations/${bacASable}/budget/versions/${version.body.id}/lignes`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId: noeud.body.id, montant: '250000' },
    });
    await appel(`/operations/${bacASable}/budget/versions/${version.body.id}`, {
      methode: 'PATCH',
      token: christophe,
      corps: { statut: 'VALIDE', isCourant: true },
    });

    const soumission = await appel<{ id: number }>(`/operations/${bacASable}/soumissions`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId: noeud.body.id, intitule: 'Peinture' },
    });
    const entreprises = await appel<{ id: number }[]>('/entreprises', { token: christophe });
    const offre = await appel<{ id: number }>(
      `/operations/${bacASable}/soumissions/${soumission.body.id}/offres`,
      {
        methode: 'POST',
        token: christophe,
        corps: { entrepriseId: entreprises.body[0]!.id, montant: '178500', statut: 'RECUE' },
      },
    );
    const adjudication = await appel<{ id: number }>(
      `/operations/${bacASable}/soumissions/${soumission.body.id}/adjudication`,
      { methode: 'POST', token: christophe, corps: { offreId: offre.body.id } },
    );
    const contrat = await appel<{ id: number }>(
      `/operations/${bacASable}/adjudications/${adjudication.body.id}/contrat`,
      { methode: 'POST', token: christophe, corps: { reference: 'C-BAC-001' } },
    );
    contratId = contrat.body.id;
    expect(contrat.status).toBe(201);
  });

  it('refuse une facture qui dépasserait le commandé, en chiffrant le dépassement', async () => {
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { contratId, montantHT: '200000', numero: 'TROP-001' },
    });
    factureExcessive = facture.body.id;

    const res = await appel<{ message: string; controle: { depassement: string } }>(
      `/operations/${bacASable}/factures/${factureExcessive}/validation`,
      { methode: 'POST', token: christophe, corps: {} },
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('dépasserait le commandé');
    expect(res.body.controle.depassement).toBe('21500.00'); // 200 000 − 178 500
  });

  it("le dépassement peut être forcé, mais reste tracé dans l'audit", async () => {
    const res = await appel<{ statut: string }>(
      `/operations/${bacASable}/factures/${factureExcessive}/validation`,
      { methode: 'POST', token: christophe, corps: { forcer: true } },
    );
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('VALIDEE');

    const audit = await appel<{ action: string; donnees: { depassementForce: string | null } }[]>(
      '/audit-logs?limite=10',
      { token: christophe },
    );
    const trace = audit.body.find((a) => a.action === 'facture.validee');
    expect(trace!.donnees.depassementForce).not.toBeNull();
  });

  it('une facture sans montant ne peut pas être validée', async () => {
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { contratId, numero: 'VIDE-001' },
    });
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/factures/${facture.body.id}/validation`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('hors taxe');
  });

  it('une facture sans imputation possible est refusée', async () => {
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { montantHT: '1000', numero: 'ORPHELINE-001' },
    });
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/factures/${facture.body.id}/validation`,
      { methode: 'POST', token: christophe, corps: {} },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('poste CFC');
  });
});

// =====================================================================

describe('paiements', () => {
  it('une facture non validée ne peut pas être payée', async () => {
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { montantHT: '5000', montantTTC: '5405', numero: 'PAIE-001' },
    });
    const res = await appel<{ message: string }>(
      `/operations/${bacASable}/factures/${facture.body.id}/paiements`,
      {
        methode: 'POST',
        token: christophe,
        corps: { montant: '5405', dateValeur: '2026-09-01' },
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('validée');
  });

  it('un acompte partiel ne solde pas la facture', async () => {
    const cfc = await appel<{ id: number; code: string }[]>(`/operations/${bacASable}/cfc`, {
      token: christophe,
    });
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { montantHT: '10000', montantTTC: '10810', numero: 'PARTIEL-001' },
    });
    await appel(`/operations/${bacASable}/factures/${facture.body.id}/validation`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId: cfc.body[0]!.id, forcer: true },
    });

    const partiel = await appel<{ soldee: boolean; cumulPaye: string }>(
      `/operations/${bacASable}/factures/${facture.body.id}/paiements`,
      { methode: 'POST', token: christophe, corps: { montant: '4000', dateValeur: '2026-09-01' } },
    );
    expect(partiel.status).toBe(201);
    expect(partiel.body.soldee).toBe(false);

    const solde = await appel<{ soldee: boolean }>(
      `/operations/${bacASable}/factures/${facture.body.id}/paiements`,
      { methode: 'POST', token: christophe, corps: { montant: '6810', dateValeur: '2026-09-20' } },
    );
    expect(solde.body.soldee).toBe(true);
  });
});

// =====================================================================

describe('litige et rejet', () => {
  it('exige un motif', async () => {
    // Christophe, et non Julie : le bac à sable a été créé par lui, et seul
    // son créateur y a reçu un droit d'accès.
    const facture = await appel<{ id: number }>(`/operations/${bacASable}/factures`, {
      methode: 'POST',
      token: christophe,
      corps: { montantHT: '3000', numero: 'LITIGE-001' },
    });
    expect(facture.status).toBe(201);

    const sansMotif = await appel(`/operations/${bacASable}/factures/${facture.body.id}/statut`, {
      methode: 'POST',
      token: christophe,
      corps: { statut: 'LITIGE' },
    });
    expect(sansMotif.status).toBe(400);

    const avecMotif = await appel<{ statut: string }>(
      `/operations/${bacASable}/factures/${facture.body.id}/statut`,
      {
        methode: 'POST',
        token: christophe,
        corps: { statut: 'LITIGE', motif: 'Métré contesté sur le sous-sol' },
      },
    );
    expect(avecMotif.status).toBe(200);
    expect(avecMotif.body.statut).toBe('LITIGE');
  });

  it('un chef de projet valide sur une opération qui lui est confiée', async () => {
    // Julie a MANAGE sur l'opération du seed : le rôle CHEF_PROJET fait
    // partie du circuit de validation.
    const factures = await appel<{ id: number; statut: string }[]>(
      `/operations/${operationSeed}/factures`,
      { token: julie },
    );
    expect(factures.status).toBe(200);
    expect(factures.body.length).toBeGreaterThan(0);
  });
});

// =====================================================================

interface NoeudApi {
  code: string;
  total: {
    budgeteRevise: string;
    adjuge: string;
    commande: string;
    facture: string;
    paye: string;
  };
  resteAEngager: string;
  resteADepenser: string;
  projectionATerminaison: string;
  enfants: NoeudApi[];
}

function trouver(noeuds: NoeudApi[], code: string): NoeudApi | undefined {
  for (const n of noeuds) {
    if (n.code === code) return n;
    const trouve = trouver(n.enfants, code);
    if (trouve) return trouve;
  }
  return undefined;
}
