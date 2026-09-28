/**
 * Ce que coûte un appel à un modèle, et ce qu'il vaut en crédits.
 *
 * Méthode commune du groupe : on débite le **coût**, jamais les jetons ; la
 * devise n'est jamais implicite ; un échec ne se facture pas.
 */
import { describe, expect, it } from 'vitest';
import {
  CHF_PAR_CREDIT,
  ROUTAGE,
  TARIFS,
  USD_EN_CHF,
  coutAppel,
  coutEnCredits,
  enFrancs,
  etagePour,
} from '../apps/api/src/ia/couts';

describe('routage : l’appelant ne choisit pas son étage', () => {
  it('lire une facture ou un site va au grand modèle suisse', () => {
    expect(etagePour('factures.lecture')).toBe('PUISSANT');
    expect(etagePour('acteurs.site-web')).toBe('PUISSANT');
  });

  it('trier un e-mail reste sur le serveur', () => {
    expect(etagePour('emails.tri')).toBe('LOCAL');
  });

  it('seule la recherche sort de Suisse', () => {
    const sortants = Object.entries(ROUTAGE).filter(([, e]) => e === 'RECHERCHE');
    expect(sortants).toEqual([['recherche.web', 'RECHERCHE']]);
  });

  it('une opération inconnue ne part pas à l’étranger par défaut', () => {
    expect(etagePour('operation.pas.encore.routee')).toBe('PUISSANT');
  });
});

describe('coût d’un appel', () => {
  it('Infomaniak : jetons en francs', () => {
    // 10 000 entrée × 0.40 + 2 000 sortie × 3.20, par million.
    const c = coutAppel('Qwen/Qwen3.5-122B-A10B-FP8', 10_000, 2_000)!;
    expect(c).toMatchObject({ devise: 'CHF', etage: 'PUISSANT', fournisseur: 'infomaniak' });
    expect(c.montant).toBeCloseTo(0.0104, 6);
  });

  it('le modèle local ne coûte rien', () => {
    expect(coutAppel('qwen3.5:4b', 50_000, 5_000)).toMatchObject({ montant: 0, etage: 'LOCAL' });
  });

  /** Le piège : le forfait par requête pèse plus que les jetons d’une recherche courte. */
  it('Perplexity : jetons en dollars ET forfait par requête', () => {
    const c = coutAppel('sonar', 800, 400)!;
    expect(c.devise).toBe('USD');
    expect(c.montant).toBeCloseTo(0.0062, 6); // 0.0012 de jetons + 0.005 de forfait
    expect(coutAppel('sonar', 800, 400, 2)!.montant).toBeCloseTo(0.0112, 6);
  });

  it('un modèle absent de la table ne prend pas le prix du voisin', () => {
    expect(coutAppel('modele-inconnu', 1000, 1000)).toBeNull();
  });

  it('chaque tarif dit sa devise, son étage et son fournisseur', () => {
    for (const [modele, t] of Object.entries(TARIFS)) {
      expect(['CHF', 'USD'], modele).toContain(t.devise);
      expect(['LOCAL', 'PUISSANT', 'RECHERCHE'], modele).toContain(t.etage);
      expect(t.fournisseur.length, modele).toBeGreaterThan(0);
    }
  });
});

describe('des francs aux crédits', () => {
  it('arrondi supérieur, et au moins un crédit dès que l’appel coûte', () => {
    expect(
      coutEnCredits({ montant: 0.0104, devise: 'CHF', etage: 'PUISSANT', fournisseur: 'i' }),
    ).toBe(21); // 0.0104 / 0.0005 = 20.8
    expect(
      coutEnCredits({ montant: 0.00001, devise: 'CHF', etage: 'PUISSANT', fournisseur: 'i' }),
    ).toBe(1);
  });

  it('un appel local ne débite rien, mais il est journalisé', () => {
    expect(
      coutEnCredits({ montant: 0, devise: 'CHF', etage: 'LOCAL', fournisseur: 'ollama' }),
    ).toBe(0);
  });

  it('un échec ne se facture pas', () => {
    expect(coutEnCredits(null)).toBe(0);
  });

  it('les dollars se convertissent au taux retenu, jamais additionnés tels quels', () => {
    expect(enFrancs(0.0062, 'USD')).toBeCloseTo(0.0062 * USD_EN_CHF, 6);
    expect(enFrancs(1, 'CHF')).toBe(1);
    expect(
      coutEnCredits({ montant: 0.0062, devise: 'USD', etage: 'RECHERCHE', fournisseur: 'p' }),
    ).toBe(10); // 0.00496 CHF / 0.0005
  });

  it('500 crédits valent bien CHF 0.25 de facture', () => {
    expect(500 * CHF_PAR_CREDIT).toBeCloseTo(0.25, 10);
  });
});
