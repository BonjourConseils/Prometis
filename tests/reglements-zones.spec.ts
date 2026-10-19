/**
 * De la zone de la parcelle à la zone du règlement.
 *
 * Les zones ci-dessous sont celles du vrai RCCZ de Martigny (art. 20), et
 * l'affectation testée est celle que porte la parcelle 18828 à l'écran
 * Foncier. Se tromper de zone fausse l'indice, donc la surface brute de
 * plancher, donc le prix qu'on accepte de payer pour le terrain.
 */
import { describe, expect, it } from 'vitest';
import { correspondreZone, normaliser, type ZoneCandidate } from '../apps/api/src/reglements/zones';

/** Les zones à bâtir de Martigny, telles que le règlement les énumère. */
const MARTIGNY: ZoneCandidate[] = [
  { id: 1, code: 'W', libelle: 'vieille ville' },
  { id: 2, code: 'VH', libelle: 'hameau' },
  { id: 3, code: 'CC', libelle: 'centre contigu A' },
  { id: 4, code: 'CD', libelle: 'centre dispersé B' },
  { id: 5, code: 'R4', libelle: 'habitat collectif A' },
  { id: 6, code: 'R3', libelle: 'habitat collectif B' },
  { id: 7, code: 'R2', libelle: 'habitat individuel' },
  { id: 8, code: 'AC', libelle: 'artisanale et commerciale' },
  { id: 9, code: 'IN', libelle: 'industrielle' },
  { id: 10, code: 'CH', libelle: 'chalet - montagne' },
];

describe('le libellé décide', () => {
  it('la zone de la parcelle 18828 est la R3', () => {
    expect(correspondreZone("Zone d'habitat collectif B (3)", MARTIGNY)?.code).toBe('R3');
  });

  it('une lettre de différence ne se confond pas', () => {
    expect(correspondreZone("Zone d'habitat collectif A (4)", MARTIGNY)?.code).toBe('R4');
    expect(correspondreZone("Zone d'habitat individuel", MARTIGNY)?.code).toBe('R2');
  });

  it('accents, apostrophes et casse ne comptent pas', () => {
    expect(correspondreZone('ZONE DU CENTRE DISPERSÉ B', MARTIGNY)?.code).toBe('CD');
    expect(correspondreZone('zone d’habitat collectif b', MARTIGNY)?.code).toBe('R3');
  });

  /** « habitat collectif B » doit passer avant un « habitat collectif » nu. */
  it('le libellé le plus précis gagne', () => {
    const avecGenerique: ZoneCandidate[] = [
      ...MARTIGNY,
      { id: 99, code: 'RX', libelle: 'habitat collectif' },
    ];
    expect(correspondreZone("Zone d'habitat collectif B (3)", avecGenerique)?.code).toBe('R3');
  });
});

describe('à défaut du libellé, le code', () => {
  it('le code cité tel quel', () => {
    expect(correspondreZone('Zone R3', MARTIGNY)?.code).toBe('R3');
    expect(correspondreZone('Affectation : VH', MARTIGNY)?.code).toBe('VH');
  });

  it('le chiffre entre parenthèses, en dernier recours', () => {
    const sansLibelles: ZoneCandidate[] = [
      { id: 5, code: 'R4', libelle: null },
      { id: 6, code: 'R3', libelle: null },
    ];
    expect(correspondreZone('Zone résidentielle (3)', sansLibelles)?.code).toBe('R3');
  });

  it('deux zones pour le même chiffre : on s’abstient', () => {
    const ambigu: ZoneCandidate[] = [
      { id: 1, code: 'R3', libelle: null },
      { id: 2, code: 'CD3', libelle: null },
    ];
    expect(correspondreZone('Zone quelconque (3)', ambigu)).toBeNull();
  });
});

describe('ce qui doit rester sans proposition', () => {
  it('rien ne ressort : on ne devine pas', () => {
    expect(correspondreZone('Zone de verdure', MARTIGNY)).toBeNull();
    expect(correspondreZone('', MARTIGNY)).toBeNull();
    expect(correspondreZone(null, MARTIGNY)).toBeNull();
    expect(correspondreZone('ab', MARTIGNY)).toBeNull();
  });

  it('sans règlement lu, aucune proposition', () => {
    expect(correspondreZone("Zone d'habitat collectif B (3)", [])).toBeNull();
  });
});

describe('normaliser', () => {
  it('réduit à une forme comparable', () => {
    expect(normaliser("Zone d'habitat collectif B (3)")).toBe('zone d habitat collectif b 3');
    expect(normaliser('  CENTRE   DISPERSÉ  B ')).toBe('centre disperse b');
  });
});
