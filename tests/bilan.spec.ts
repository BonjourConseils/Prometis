/**
 * Bilan promoteur — calcul pur.
 *
 * C'est le premier chiffre que le promoteur regarde, et celui qu'il
 * confrontera à ses propres tableaux lors du pilote. Il doit être juste au
 * centime, y compris sur des montants à sept chiffres où un `parseFloat`
 * commencerait à dériver.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calculerBilan,
  groupePrincipal,
  type LigneCout,
  type LigneRecette,
} from '../apps/api/src/operations/bilan.js';

const d = (v: string) => new Prisma.Decimal(v);

describe('groupe principal CFC', () => {
  it('prend le premier chiffre du code, avant le point', () => {
    expect(groupePrincipal('232.1')).toBe('2');
    expect(groupePrincipal('271.0')).toBe('2');
    expect(groupePrincipal('01')).toBe('0');
    expect(groupePrincipal('4')).toBe('4');
    expect(groupePrincipal('56')).toBe('5');
  });
});

describe('cas de référence — Les Jardins de Prilly', () => {
  const couts: LigneCout[] = [
    { codeCfc: '01', montant: d('3200000'), estReserve: false },
    { codeCfc: '02', montant: d('190000'), estReserve: false },
    { codeCfc: '211', montant: d('3100000'), estReserve: false },
    { codeCfc: '232.1', montant: d('540000'), estReserve: false },
    { codeCfc: '59', montant: d('450000'), estReserve: true },
  ];

  const recettes: LigneRecette[] = [
    { prixVente: d('815000'), parkings: [d('35000')] },
    { prixVente: d('695000'), parkings: [d('30000')] },
  ];

  const bilan = calculerBilan(couts, recettes);

  it('additionne les coûts sans rien perdre', () => {
    expect(bilan.couts.total.equals(d('7480000'))).toBe(true);
  });

  it('isole les réserves du reste des coûts', () => {
    expect(bilan.couts.reserves.equals(d('450000'))).toBe(true);
    expect(bilan.couts.horsReserves.equals(d('7030000'))).toBe(true);
  });

  it('agrège par groupe principal CFC', () => {
    const parGroupe = Object.fromEntries(
      bilan.couts.parGroupeCfc.map((g) => [g.groupe, g.montant.toString()]),
    );
    expect(parGroupe).toEqual({
      '0': '3390000',
      '2': '3640000',
      '5': '450000',
    });
  });

  it('sépare recettes des lots et des parkings', () => {
    expect(bilan.recettes.lots.equals(d('1510000'))).toBe(true);
    expect(bilan.recettes.parkings.equals(d('65000'))).toBe(true);
    expect(bilan.recettes.total.equals(d('1575000'))).toBe(true);
    expect(bilan.recettes.nombreLots).toBe(2);
  });

  it('calcule la marge et son taux', () => {
    expect(bilan.marge.equals(d('-5905000'))).toBe(true);
    expect(bilan.tauxMargePct!.equals(d('-374.92'))).toBe(true);
  });
});

describe('précision décimale', () => {
  it('additionne des centimes sans dérive', () => {
    // 0.1 + 0.2 vaut 0.30000000000000004 en flottant.
    const bilan = calculerBilan(
      [
        { codeCfc: '1', montant: d('0.10'), estReserve: false },
        { codeCfc: '1', montant: d('0.20'), estReserve: false },
      ],
      [],
    );
    expect(bilan.couts.total.equals(d('0.30'))).toBe(true);
    expect(bilan.couts.total.toString()).toBe('0.3');
  });

  it('tient sur des montants à sept chiffres', () => {
    const bilan = calculerBilan(
      [{ codeCfc: '2', montant: d('12179999.99'), estReserve: false }],
      [{ prixVente: d('15845999.98'), parkings: [d('0.01')] }],
    );
    expect(bilan.marge.equals(d('3666000.00'))).toBe(true);
  });
});

describe('cas limites', () => {
  it('sans recette, le taux de marge est null et non zéro', () => {
    // Zéro se lirait « marge nulle » alors qu'il n'y a rien à vendre.
    const bilan = calculerBilan([{ codeCfc: '2', montant: d('100'), estReserve: false }], []);
    expect(bilan.tauxMargePct).toBeNull();
    expect(bilan.marge.equals(d('-100'))).toBe(true);
  });

  it('ignore les prix absents sans planter', () => {
    const bilan = calculerBilan(
      [],
      [
        { prixVente: null, parkings: [null, d('30000')] },
        { prixVente: d('500000'), parkings: [] },
      ],
    );
    expect(bilan.recettes.total.equals(d('530000'))).toBe(true);
    expect(bilan.recettes.nombreLots).toBe(2);
  });

  it('un bilan vide reste cohérent', () => {
    const bilan = calculerBilan([], []);
    expect(bilan.couts.total.isZero()).toBe(true);
    expect(bilan.recettes.total.isZero()).toBe(true);
    expect(bilan.marge.isZero()).toBe(true);
    expect(bilan.tauxMargePct).toBeNull();
  });

  it('un avoir (montant négatif) diminue les coûts', () => {
    const bilan = calculerBilan(
      [
        { codeCfc: '2', montant: d('100000'), estReserve: false },
        { codeCfc: '2', montant: d('-15000'), estReserve: false },
      ],
      [],
    );
    expect(bilan.couts.total.equals(d('85000'))).toBe(true);
  });
});
