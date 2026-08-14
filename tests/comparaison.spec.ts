/**
 * Comparaison des offres — calcul pur.
 *
 * C'est sur ce tableau que se prend la décision d'adjuger. Une erreur de
 * classement ne se voit pas : elle se traduit par un contrat signé avec le
 * mauvais soumissionnaire.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { comparerOffres, type OffreSource } from '../apps/api/src/soumissions/comparaison.js';

const d = (v: string) => new Prisma.Decimal(v);

const offre = (
  id: number,
  nom: string,
  montant: string | null,
  extra: Partial<OffreSource> = {},
): OffreSource => ({
  id,
  entrepriseId: id * 10,
  entrepriseNom: nom,
  montant: montant === null ? null : d(montant),
  remisePct: null,
  statut: 'RECUE',
  dateReception: null,
  ...extra,
});

describe('classement au montant net', () => {
  // Cas du seed : Currat est plus cher au brut, moins-disant après remise.
  const offres = [
    offre(1, 'Rossier', '498000'),
    offre(2, 'Currat', '505000', { remisePct: d('2.00') }),
    offre(3, 'Elektro Vaud', '551900'),
  ];
  const c = comparerOffres(offres, d('540000'));

  it('applique la remise avant de comparer', () => {
    const currat = c.offres.find((o) => o.entrepriseNom === 'Currat')!;
    expect(currat.montantBrut!.equals(d('505000'))).toBe(true);
    expect(currat.montantNet!.equals(d('494900'))).toBe(true);
  });

  it('classe au net, pas au brut', () => {
    // Au brut, Rossier serait premier. C'est le net qui engage.
    const parRang = c.offres.filter((o) => o.rang).sort((a, b) => a.rang! - b.rang!);
    expect(parRang.map((o) => o.entrepriseNom)).toEqual(['Currat', 'Rossier', 'Elektro Vaud']);
  });

  it('propose le moins-disant net', () => {
    expect(c.propositionOffreId).toBe(2);
    expect(c.moinsDisant!.equals(d('494900'))).toBe(true);
  });

  it('mesure la dispersion du marché', () => {
    expect(c.dispersion!.equals(d('57000'))).toBe(true);
    expect(c.dispersionPct!.equals(d('11.52'))).toBe(true);
  });

  it('situe chaque offre par rapport au budget du poste', () => {
    const currat = c.offres.find((o) => o.entrepriseNom === 'Currat')!;
    const elektro = c.offres.find((o) => o.entrepriseNom === 'Elektro Vaud')!;
    expect(currat.ecartBudget!.equals(d('-45100'))).toBe(true);
    expect(currat.ecartBudgetPct!.equals(d('-8.35'))).toBe(true);
    // Seule offre au-dessus du budget.
    expect(elektro.ecartBudgetPct!.greaterThan(0)).toBe(true);
  });

  it('note le moins-disant à 100 et dégrade ensuite', () => {
    const notes = c.offres
      .filter((o) => o.notePrix)
      .sort((a, b) => a.rang! - b.rang!)
      .map((o) => o.notePrix!.toString());
    expect(notes[0]).toBe('100');
    expect(Number(notes[1])).toBeLessThan(100);
    expect(Number(notes[2])).toBeLessThan(Number(notes[1]));
  });
});

describe('offres non comparables', () => {
  const c = comparerOffres(
    [
      offre(1, 'Avec prix', '100000'),
      offre(2, 'Sans prix', null, { statut: 'ATTENDUE' }),
      offre(3, 'Écartée', '90000', { statut: 'ECARTEE' }),
      offre(4, 'Montant nul', '0'),
    ],
    d('120000'),
  );

  it('les exclut du classement en disant pourquoi', () => {
    const parNom = Object.fromEntries(c.offres.map((o) => [o.entrepriseNom, o]));
    expect(parNom['Sans prix']!.motifExclusion).toBe('Prix non reçu');
    expect(parNom['Écartée']!.motifExclusion).toBe('Offre écartée');
    expect(parNom['Montant nul']!.motifExclusion).toBe('Montant invalide');
    expect(parNom['Avec prix']!.motifExclusion).toBeNull();
  });

  it("n'en compte qu'une comme comparable", () => {
    expect(c.nombreComparables).toBe(1);
    expect(c.propositionOffreId).toBe(1);
  });

  it('une offre écartée moins chère ne devient pas la proposition', () => {
    // Elle est à 90 000 contre 100 000 : sans l'exclusion, elle passerait
    // devant alors qu'elle a été volontairement mise de côté.
    expect(c.moinsDisant!.equals(d('100000'))).toBe(true);
  });

  it('les affiche quand même dans le tableau', () => {
    expect(c.offres).toHaveLength(4);
  });
});

describe('cas limites', () => {
  it('sans offre, rien à proposer', () => {
    const c = comparerOffres([], d('100000'));
    expect(c.propositionOffreId).toBeNull();
    expect(c.moinsDisant).toBeNull();
    expect(c.dispersion).toBeNull();
    expect(c.nombreComparables).toBe(0);
  });

  it('sans budget, les écarts au budget sont absents mais le classement tient', () => {
    const c = comparerOffres([offre(1, 'A', '100'), offre(2, 'B', '90')], null);
    expect(c.offres.every((o) => o.ecartBudget === null)).toBe(true);
    expect(c.propositionOffreId).toBe(2);
  });

  it('une offre unique est proposée sans dispersion', () => {
    const c = comparerOffres([offre(1, 'Seule', '250000')], d('260000'));
    expect(c.propositionOffreId).toBe(1);
    expect(c.dispersion!.isZero()).toBe(true);
    expect(c.offres[0]!.notePrix!.equals(d('100'))).toBe(true);
  });

  it('départage deux offres identiques par date de réception', () => {
    // Un ordre stable vaut mieux qu'un classement qui change d'un
    // rafraîchissement à l'autre.
    const c = comparerOffres(
      [
        offre(1, 'Tardive', '100000', { dateReception: new Date('2026-06-10') }),
        offre(2, 'Première', '100000', { dateReception: new Date('2026-06-01') }),
      ],
      null,
    );
    expect(c.propositionOffreId).toBe(2);
  });

  it('une remise de 100 % ramène le net à zéro sans planter', () => {
    const c = comparerOffres([offre(1, 'Gratuite', '50000', { remisePct: d('100') })], null);
    expect(c.offres[0]!.montantNet!.isZero()).toBe(true);
    expect(c.offres[0]!.notePrix).toBeNull();
  });
});
