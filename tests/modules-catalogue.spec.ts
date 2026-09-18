/**
 * Le catalogue des modules commerciaux — la règle qui dit ce qu'une société
 * peut ouvrir, et ce qu'elle garde après résiliation.
 */
import { describe, expect, it } from 'vitest';
import { CATALOGUE, SOCLE, modulesTechniques } from '../apps/api/src/modules/catalogue';

const JOUR = 86_400_000;
const maintenant = new Date('2026-09-18T12:00:00Z');

describe('Le socle', () => {
  it('toute société l’a, même sans rien souscrire', () => {
    const { actifs } = modulesTechniques([], 'ENTREPRISE_GENERALE', maintenant);
    for (const m of SOCLE) expect(actifs).toContain(m);
  });

  it('le budget CFC est dans le socle — factures et appels d’offres en dépendent', () => {
    expect(SOCLE).toContain('BUDGET_CFC');
  });
});

describe('Ce qu’ouvre une souscription', () => {
  it('un module actif ouvre tous ses modules techniques', () => {
    const { actifs } = modulesTechniques(
      [{ module: 'APPELS_DE_FONDS', statut: 'ACTIF' }],
      'PROMOTEUR',
      maintenant,
    );
    expect(actifs).toEqual(
      expect.arrayContaining(['LOTS', 'APPELS_FONDS', 'ECHEANCIER', 'TRESORERIE']),
    );
  });

  it('un essai en cours ouvre, un essai échu passe en lecture seule', () => {
    const encours = modulesTechniques(
      [{ module: 'PASSEPORT', statut: 'ESSAI', finEssai: new Date(maintenant.getTime() + JOUR) }],
      'PROMOTEUR',
      maintenant,
    );
    expect(encours.actifs).toContain('PASSEPORT');

    const echu = modulesTechniques(
      [{ module: 'PASSEPORT', statut: 'ESSAI', finEssai: new Date(maintenant.getTime() - JOUR) }],
      'PROMOTEUR',
      maintenant,
    );
    expect(echu.actifs).not.toContain('PASSEPORT');
    expect(echu.lecture).toContain('PASSEPORT');
  });

  it('résilier ne détruit rien : les modules passent en lecture seule', () => {
    const { actifs, lecture } = modulesTechniques(
      [{ module: 'APPELS_DE_FONDS', statut: 'RESILIE' }],
      'PROMOTEUR',
      maintenant,
    );
    expect(actifs).not.toContain('APPELS_FONDS');
    expect(lecture).toContain('APPELS_FONDS');
  });

  it('un module partagé reste ouvert tant qu’un de ses porteurs l’est', () => {
    // CONTRATS appartient aux factures ET aux appels d'offres : résilier l'un
    // ne doit pas fermer les contrats dont l'autre a besoin.
    const { actifs, lecture } = modulesTechniques(
      [
        { module: 'APPELS_OFFRES', statut: 'RESILIE' },
        { module: 'CONTROLE_FACTURES', statut: 'ACTIF' },
      ],
      'ENTREPRISE_GENERALE',
      maintenant,
    );
    expect(actifs).toContain('CONTRATS');
    expect(lecture).not.toContain('CONTRATS');
    expect(lecture).toContain('SOUMISSIONS');
  });

  it('une entreprise générale ne reçoit jamais la commercialisation, même souscrite', () => {
    const { actifs, lecture } = modulesTechniques(
      [{ module: 'APPELS_DE_FONDS', statut: 'ACTIF' }],
      'ENTREPRISE_GENERALE',
      maintenant,
    );
    expect(actifs).not.toContain('LOTS');
    expect(lecture).not.toContain('LOTS');
  });

  it('un code inconnu n’ouvre rien', () => {
    const { actifs } = modulesTechniques(
      [{ module: 'TOUT', statut: 'ACTIF' }],
      'PROMOTEUR',
      maintenant,
    );
    expect(actifs).toEqual([...SOCLE].sort());
  });
});

describe('Le catalogue lui-même', () => {
  it('chaque module technique vendable appartient à au moins un module commercial', () => {
    const vendus = new Set(CATALOGUE.flatMap((m) => m.techniques));
    const horsSocle = [
      'SOUMISSIONS',
      'ADJUDICATIONS',
      'CONTRATS',
      'FACTURES',
      'LOTS',
      'ACQUEREURS',
      'BILAN_PROMOTEUR',
      'ECHEANCIER',
      'APPELS_FONDS',
      'TRESORERIE',
      'COURTAGE',
      'PASSEPORT',
    ];
    for (const m of horsSocle) expect(vendus.has(m as never)).toBe(true);
  });

  it('aucun module commercial ne revend un module du socle', () => {
    for (const m of CATALOGUE) for (const t of m.techniques) expect(SOCLE).not.toContain(t);
  });
});
