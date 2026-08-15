/**
 * Lot 8 — les règles des modules annexes, sans base ni fichier.
 *
 * Quatre sujets indépendants, réunis parce qu'ils partagent une propriété :
 * chacun est une fonction pure sur laquelle repose quelque chose de coûteux —
 * un chemin de fichier qu'un nom malveillant pourrait détourner, un PV qui
 * fait foi, une commission due à un tiers, une position de trésorerie.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assainirNomFichier,
  cleObjetSure,
  construireCleObjet,
} from '../apps/api/src/stockage/chemin';
import { dateSuisse, enRetard, redigerPv } from '../apps/api/src/seances/pv';
import {
  calculerCommission,
  conflitExclusivite,
  mandatCouvre,
} from '../apps/api/src/courtage/commission';
import { cleMois, consolider, type Mouvement } from '../apps/api/src/tresorerie/consolidation';

const chf = (v: string) => new Prisma.Decimal(v);

// ---------------------------------------------------------------------
//  Chemins de stockage
// ---------------------------------------------------------------------

describe('Assainissement des noms de fichier', () => {
  it('conserve un nom simple et son extension', () => {
    expect(assainirNomFichier('Plan-RDC.pdf')).toBe('plan-rdc.pdf');
  });

  it('retire les accents et les espaces', () => {
    expect(assainirNomFichier('Procès-verbal séance N°12.PDF')).toBe(
      'proces-verbal-seance-n-12.pdf',
    );
  });

  it('neutralise une tentative de remontée de répertoire', () => {
    // Le point de bascule : un nom de fichier vient d'un utilisateur.
    const assaini = assainirNomFichier('../../../etc/passwd');
    expect(assaini).not.toContain('..');
    expect(assaini).not.toContain('/');
  });

  it('ne garde jamais un nom vide', () => {
    expect(assainirNomFichier('...')).toBe('document');
    expect(assainirNomFichier('   ')).toBe('document');
  });
});

describe('Clés d’objet', () => {
  it('préfixe par la société, puis par l’opération', () => {
    const cle = construireCleObjet({
      societeId: 1,
      operationId: 7,
      nomFichier: 'plan.pdf',
      annee: 2026,
    });
    expect(cle.startsWith('societes/1/operations/7/2026/')).toBe(true);
    expect(cle.endsWith('-plan.pdf')).toBe(true);
  });

  it('ne produit jamais deux fois la même clé pour le même nom', () => {
    const commun = { societeId: 1, operationId: 7, nomFichier: 'plan.pdf', annee: 2026 };
    expect(construireCleObjet(commun)).not.toBe(construireCleObjet(commun));
  });

  it('accepte ce qu’elle produit, refuse ce qui sort du répertoire', () => {
    expect(cleObjetSure(construireCleObjet({ societeId: 2, nomFichier: 'a.pdf' }))).toBe(true);
    expect(cleObjetSure('societes/1/../../etc/passwd')).toBe(false);
    expect(cleObjetSure('/etc/passwd')).toBe(false);
    expect(cleObjetSure('societes\\1\\plan.pdf')).toBe(false);
    expect(cleObjetSure('')).toBe(false);
  });
});

// ---------------------------------------------------------------------
//  Procès-verbal
// ---------------------------------------------------------------------

const seanceExemple = {
  titre: 'Séance de chantier',
  numero: 'Chantier #12',
  type: 'CHANTIER',
  date: new Date('2026-08-12T00:00:00Z'),
  lieu: 'Prilly, bureau de chantier',
  ordreDuJour: null,
  notes: null,
  operationNom: 'Les Jardins de Prilly',
  societeNom: 'CB Promotions SA',
};

describe('Rédaction du procès-verbal', () => {
  it('porte l’en-tête, les présents et les excusés', () => {
    const pv = redigerPv(
      seanceExemple,
      [
        { nom: 'Julie Renaud', organisation: 'CB Promotions', present: true },
        { nom: 'Marc Girard', organisation: 'Constructa', present: false },
      ],
      [],
    );
    expect(pv).toContain('# Chantier #12 — Séance de chantier');
    expect(pv).toContain('12.08.2026');
    expect(pv).toContain('- Julie Renaud (CB Promotions)');
    expect(pv).toContain('**Excusés**');
    expect(pv).toContain('- Marc Girard (Constructa)');
  });

  it('récapitule les points qui restent ouverts', () => {
    // C'est la section qu'on relit trois semaines plus tard : elle doit
    // exister même quand le corps du PV est long.
    const pv = redigerPv(
      seanceExemple,
      [],
      [
        {
          ordre: 1,
          titre: 'Étanchéité toiture',
          contenu: 'Reprise à faire.',
          responsable: 'Currat SA',
          echeance: new Date('2026-09-01T00:00:00Z'),
          statut: 'OUVERT',
        },
        { ordre: 2, titre: 'Choix des sanitaires', statut: 'CLOS' },
      ],
    );

    expect(pv).toContain('## Points restant ouverts');
    expect(pv).toContain('**Étanchéité toiture** — Currat SA, échéance 01.09.2026');
    expect(pv).not.toContain('- **Choix des sanitaires**');
  });

  it('n’affiche pas de section « points ouverts » quand tout est clos', () => {
    const pv = redigerPv(seanceExemple, [], [{ ordre: 1, titre: 'Fait', statut: 'CLOS' }]);
    expect(pv).not.toContain('## Points restant ouverts');
  });

  it('dit qu’aucun point n’a été consigné plutôt que de laisser un blanc', () => {
    expect(redigerPv(seanceExemple, [], [])).toContain('*Aucun point consigné.*');
  });

  it('formate les dates à la suisse', () => {
    expect(dateSuisse(new Date('2026-01-05T00:00:00Z'))).toBe('05.01.2026');
    expect(dateSuisse(null)).toBe('—');
  });
});

describe('Point d’action en retard', () => {
  const maintenant = new Date('2026-08-14T00:00:00Z');

  it('est en retard si l’échéance est passée et le point non clos', () => {
    const point = {
      ordre: 1,
      titre: 'x',
      echeance: new Date('2026-08-01T00:00:00Z'),
      statut: 'OUVERT' as const,
    };
    expect(enRetard(point, maintenant)).toBe(true);
  });

  it('n’est pas en retard une fois clos, même échéance dépassée', () => {
    const point = {
      ordre: 1,
      titre: 'x',
      echeance: new Date('2026-08-01T00:00:00Z'),
      statut: 'CLOS' as const,
    };
    expect(enRetard(point, maintenant)).toBe(false);
  });

  it('n’est pas en retard sans échéance — on ne l’invente pas', () => {
    expect(enRetard({ ordre: 1, titre: 'x', statut: 'OUVERT' }, maintenant)).toBe(false);
  });
});

// ---------------------------------------------------------------------
//  Commissions de courtage
// ---------------------------------------------------------------------

describe('Calcul d’une commission', () => {
  it('applique le pourcentage sur le prix hors taxe par défaut', () => {
    const commission = calculerCommission(
      {
        commissionType: 'POURCENTAGE',
        commissionPct: chf('3'),
        commissionForfait: null,
        assietteTtc: false,
      },
      chf('850000'),
    );
    expect(commission.montant.toFixed(2)).toBe('25500.00');
    expect(commission.motif).toContain('hors taxe');
  });

  it('reconstitue l’assiette TTC quand le mandat le stipule', () => {
    // 850 000 × 1,081 = 918 850 → 3 % = 27 565.50. Ignorer la mention « TTC »
    // du mandat coûterait 2 065.50 CHF au courtier sur ce seul lot.
    const commission = calculerCommission(
      {
        commissionType: 'POURCENTAGE',
        commissionPct: chf('3'),
        commissionForfait: null,
        assietteTtc: true,
      },
      chf('850000'),
    );
    expect(commission.assiette.toFixed(2)).toBe('918850.00');
    expect(commission.montant.toFixed(2)).toBe('27565.50');
  });

  it('laisse le forfait indépendant du prix de vente', () => {
    const mandat = {
      commissionType: 'FORFAIT' as const,
      commissionPct: null,
      commissionForfait: chf('15000'),
      assietteTtc: true,
    };
    expect(calculerCommission(mandat, chf('600000')).montant.toFixed(2)).toBe('15000.00');
    expect(calculerCommission(mandat, chf('900000')).montant.toFixed(2)).toBe('15000.00');
  });

  it('refuse de calculer sans taux, sans forfait, ou sans assiette', () => {
    expect(() =>
      calculerCommission(
        {
          commissionType: 'POURCENTAGE',
          commissionPct: null,
          commissionForfait: null,
          assietteTtc: false,
        },
        chf('850000'),
      ),
    ).toThrow(/taux/);
    expect(() =>
      calculerCommission(
        {
          commissionType: 'FORFAIT',
          commissionPct: null,
          commissionForfait: null,
          assietteTtc: false,
        },
        chf('850000'),
      ),
    ).toThrow(/montant/);
    expect(() =>
      calculerCommission(
        {
          commissionType: 'POURCENTAGE',
          commissionPct: chf('3'),
          commissionForfait: null,
          assietteTtc: false,
        },
        null,
      ),
    ).toThrow(/prix total acte/);
  });
});

describe('Périmètre d’un mandat', () => {
  it('couvre tout quand le périmètre est l’opération entière', () => {
    expect(mandatCouvre({ perimetre: 'TOUTE_OPERATION', lotIds: [] }, 42)).toBe(true);
  });

  it('ne couvre que les lots listés', () => {
    expect(mandatCouvre({ perimetre: 'LOTS_SELECTIONNES', lotIds: [1, 2] }, 2)).toBe(true);
    expect(mandatCouvre({ perimetre: 'LOTS_SELECTIONNES', lotIds: [1, 2] }, 3)).toBe(false);
  });

  it('ne couvre RIEN avec une liste vide', () => {
    // Traiter la liste vide comme « tout » ferait naître des commissions sur
    // des lots qu'aucun courtier n'a vendus.
    expect(mandatCouvre({ perimetre: 'LOTS_SELECTIONNES', lotIds: [] }, 1)).toBe(false);
  });
});

describe('Conflits d’exclusivité', () => {
  it('signale deux exclusivités sur un même lot', () => {
    const conflit = conflitExclusivite(
      { exclusif: true, perimetre: 'LOTS_SELECTIONNES', lotIds: [3, 4] },
      [{ id: 9, exclusif: true, perimetre: 'LOTS_SELECTIONNES', lotIds: [4, 5] }],
    );
    expect(conflit).toEqual({ mandatId: 9, lotsEnConflit: [4] });
  });

  it('signale une exclusivité face à un mandat couvrant toute l’opération', () => {
    const conflit = conflitExclusivite(
      { exclusif: true, perimetre: 'LOTS_SELECTIONNES', lotIds: [3] },
      [{ id: 9, exclusif: false, perimetre: 'TOUTE_OPERATION', lotIds: [] }],
    );
    expect(conflit?.mandatId).toBe(9);
  });

  it('laisse cohabiter deux mandats non exclusifs', () => {
    const conflit = conflitExclusivite(
      { exclusif: false, perimetre: 'TOUTE_OPERATION', lotIds: [] },
      [{ id: 9, exclusif: false, perimetre: 'TOUTE_OPERATION', lotIds: [] }],
    );
    expect(conflit).toBeNull();
  });
});

// ---------------------------------------------------------------------
//  Trésorerie
// ---------------------------------------------------------------------

function mouvement(
  date: string,
  montant: string,
  sens: 'ENCAISSEMENT' | 'DECAISSEMENT',
): Mouvement {
  return { date: new Date(`${date}T00:00:00Z`), montant: chf(montant), sens, libelle: 'test' };
}

describe('Consolidation de trésorerie', () => {
  it('regroupe par mois et cumule la position', () => {
    const c = consolider([
      mouvement('2026-03-10', '100000', 'ENCAISSEMENT'),
      mouvement('2026-03-20', '40000', 'DECAISSEMENT'),
      mouvement('2026-04-05', '30000', 'DECAISSEMENT'),
    ]);

    expect(c.mois.map((m) => m.mois)).toEqual(['2026-03', '2026-04']);
    expect(c.mois[0]!.net.toFixed(2)).toBe('60000.00');
    expect(c.mois[1]!.cumul.toFixed(2)).toBe('30000.00');
    expect(c.position.toFixed(2)).toBe('30000.00');
    expect(c.totalEncaisse.toFixed(2)).toBe('100000.00');
    expect(c.totalDecaisse.toFixed(2)).toBe('70000.00');
  });

  it('comble les mois sans mouvement', () => {
    // Sauter de mars à juin laisserait croire à une trésorerie continue là où
    // il ne s'est rien passé, et masquerait le creux.
    const c = consolider([
      mouvement('2026-03-10', '10000', 'ENCAISSEMENT'),
      mouvement('2026-06-10', '5000', 'ENCAISSEMENT'),
    ]);
    expect(c.mois.map((m) => m.mois)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(c.mois[1]!.nombreMouvements).toBe(0);
    expect(c.mois[1]!.cumul.toFixed(2)).toBe('10000.00');
  });

  it('désigne le mois où la position est au plus bas', () => {
    const c = consolider([
      mouvement('2026-01-10', '50000', 'DECAISSEMENT'),
      mouvement('2026-02-10', '80000', 'DECAISSEMENT'),
      mouvement('2026-03-10', '200000', 'ENCAISSEMENT'),
    ]);
    expect(c.creux).not.toBeNull();
    expect(c.creux!.mois).toBe('2026-02');
    expect(c.creux!.position.toFixed(2)).toBe('-130000.00');
    expect(c.position.toFixed(2)).toBe('70000.00');
  });

  it('franchit correctement une fin d’année', () => {
    const c = consolider([
      mouvement('2026-11-10', '1000', 'ENCAISSEMENT'),
      mouvement('2027-02-10', '1000', 'ENCAISSEMENT'),
    ]);
    expect(c.mois.map((m) => m.mois)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('renvoie une consolidation vide sans mouvement, sans planter', () => {
    const c = consolider([]);
    expect(c.mois).toHaveLength(0);
    expect(c.position.toFixed(2)).toBe('0.00');
    expect(c.creux).toBeNull();
  });

  it('produit une clé de mois triable', () => {
    expect(cleMois(new Date('2026-01-31T00:00:00Z'))).toBe('2026-01');
    expect(cleMois(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });
});
