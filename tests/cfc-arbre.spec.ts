/**
 * Agrégation sur l'arbre CFC et ventilation — calculs purs.
 *
 * L'arbre CFC est la colonne vertébrale du produit : c'est sur lui que se lit
 * le fil rouge Budgété → Adjugé → Commandé → Facturé → Payé. Un total qui
 * remonte mal se voit rarement à l'œil nu sur 40 postes.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  construireArbreCfc,
  ventiler,
  type LotVentilable,
  type NoeudSource,
} from '../apps/api/src/budget/cfc-arbre.js';

const d = (v: string | number) => new Prisma.Decimal(v);

const noeud = (
  id: number,
  code: string,
  niveau: number,
  parentId: number | null = null,
  ordre = 0,
): NoeudSource => ({ id, parentId, code, libelle: `Poste ${code}`, niveau, ordre });

describe('remontée des montants', () => {
  //  2 ─┬─ 21 ─── 211
  //     └─ 22
  const noeuds = [
    noeud(1, '2', 1),
    noeud(2, '21', 2, 1),
    noeud(3, '211', 3, 2),
    noeud(4, '22', 2, 1, 1),
  ];

  const { arbre, total } = construireArbreCfc(noeuds, [
    { cfcNodeId: 3, budgeteRevise: d('3100000') },
    { cfcNodeId: 4, budgeteRevise: d('620000') },
    // Montant saisi directement sur le groupe, sans sous-poste.
    { cfcNodeId: 1, budgeteRevise: d('420000') },
  ]);

  it("distingue le montant propre d'un poste de son total", () => {
    const groupe2 = arbre[0]!;
    expect(groupe2.propre.budgeteRevise.equals(d('420000'))).toBe(true);
    expect(groupe2.total.budgeteRevise.equals(d('4140000'))).toBe(true);
  });

  it('remonte sur plusieurs niveaux', () => {
    const gros1 = arbre[0]!.enfants.find((e) => e.code === '21')!;
    expect(gros1.propre.budgeteRevise.isZero()).toBe(true);
    expect(gros1.total.budgeteRevise.equals(d('3100000'))).toBe(true);
  });

  it('donne un total général cohérent', () => {
    expect(total.budgeteRevise.equals(d('4140000'))).toBe(true);
  });

  it('trie les enfants par ordre puis par code', () => {
    expect(arbre[0]!.enfants.map((e) => e.code)).toEqual(['21', '22']);
  });
});

describe('colonnes dérivées', () => {
  const { arbre } = construireArbreCfc(
    [noeud(1, '2', 1)],
    [
      {
        cfcNodeId: 1,
        budgeteInitial: d('1000000'),
        budgeteRevise: d('1100000'),
        commande: d('900000'),
        facture: d('400000'),
      },
    ],
  );
  const poste = arbre[0]!;

  it('reste à engager = révisé − commandé', () => {
    expect(poste.resteAEngager.equals(d('200000'))).toBe(true);
  });

  it('reste à dépenser = commandé − facturé', () => {
    expect(poste.resteADepenser.equals(d('500000'))).toBe(true);
  });

  it('écart de révision = révisé − initial', () => {
    expect(poste.ecartRevisionInitial.equals(d('100000'))).toBe(true);
  });

  it('un dépassement donne un écart budget/facturé négatif', () => {
    const { arbre: a } = construireArbreCfc(
      [noeud(1, '2', 1)],
      [{ cfcNodeId: 1, budgeteRevise: d('100000'), facture: d('130000') }],
    );
    expect(a[0]!.ecartBudgetFacture.equals(d('-30000'))).toBe(true);
  });
});

describe('robustesse de l’arbre', () => {
  it('remonte les orphelins à la racine plutôt que de les perdre', () => {
    // Le parent 99 n'existe pas. Ignorer ce nœud ferait disparaître 50 000
    // du total de l'opération, sans le moindre signal.
    const { arbre, total } = construireArbreCfc(
      [noeud(1, '2', 1), noeud(2, '277', 3, 99)],
      [
        { cfcNodeId: 1, budgeteRevise: d('100000') },
        { cfcNodeId: 2, budgeteRevise: d('50000') },
      ],
    );
    expect(arbre).toHaveLength(2);
    expect(total.budgeteRevise.equals(d('150000'))).toBe(true);
  });

  it('additionne plusieurs lignes sur le même poste', () => {
    const { total } = construireArbreCfc(
      [noeud(1, '2', 1)],
      [
        { cfcNodeId: 1, budgeteRevise: d('10000') },
        { cfcNodeId: 1, budgeteRevise: d('5000') },
      ],
    );
    expect(total.budgeteRevise.equals(d('15000'))).toBe(true);
  });

  it('un arbre sans montant reste à zéro sans planter', () => {
    const { arbre, total } = construireArbreCfc([noeud(1, '2', 1)], []);
    expect(arbre[0]!.total.budgeteRevise.isZero()).toBe(true);
    expect(total.adjuge.isZero()).toBe(true);
  });

  it('un arbre vide ne produit rien', () => {
    const { arbre, total } = construireArbreCfc([], []);
    expect(arbre).toEqual([]);
    expect(total.budgeteRevise.isZero()).toBe(true);
  });
});

// =====================================================================

const lots: LotVentilable[] = [
  { id: 1, reference: 'A01', quotePartPPE: d('300'), surfaceM2: d('80') },
  { id: 2, reference: 'A02', quotePartPPE: d('300'), surfaceM2: d('100') },
  { id: 3, reference: 'A03', quotePartPPE: d('400'), surfaceM2: d('120') },
];

const sommeDes = (parts: { montant: Prisma.Decimal }[]) =>
  parts.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), new Prisma.Decimal(0));

describe('ventilation sur les lots', () => {
  it('répartit selon la quote-part PPE', () => {
    const { parts } = ventiler(d('1000000'), lots, 'QUOTE_PART_PPE');
    expect(parts.map((p) => p.montant.toString())).toEqual(['300000', '300000', '400000']);
  });

  it('répartit selon la surface', () => {
    const { parts } = ventiler(d('300000'), lots, 'SURFACE');
    expect(sommeDes(parts).equals(d('300000'))).toBe(true);
    expect(parts[2]!.montant.greaterThan(parts[0]!.montant)).toBe(true);
  });

  it('répartit à égalité', () => {
    const { parts } = ventiler(d('900000'), lots, 'EGALITE');
    expect(parts.map((p) => p.montant.toString())).toEqual(['300000', '300000', '300000']);
  });

  it('la somme retombe EXACTEMENT sur le montant, malgré les arrondis', () => {
    // 1 000 000 / 3 = 333 333.33 ; trois fois = 999 999.99. Le résidu doit
    // être absorbé, sinon le budget ne se referme pas au centime.
    const { parts } = ventiler(d('1000000'), lots, 'EGALITE');
    expect(sommeDes(parts).equals(d('1000000'))).toBe(true);
    expect(parts[2]!.montant.equals(d('333333.34'))).toBe(true);
  });

  it('reste exacte sur un montant à décimales', () => {
    const { parts } = ventiler(d('12180000.07'), lots, 'QUOTE_PART_PPE');
    expect(sommeDes(parts).equals(d('12180000.07'))).toBe(true);
  });

  it('retombe sur l’égalité si aucune quote-part n’est saisie', () => {
    // Sinon la ventilation renverrait zéro partout : un piège silencieux.
    const sansQuotePart = lots.map((l) => ({ ...l, quotePartPPE: null }));
    const { parts, cleEffective } = ventiler(d('300000'), sansQuotePart, 'QUOTE_PART_PPE');
    expect(cleEffective).toBe('EGALITE');
    expect(parts.map((p) => p.montant.toString())).toEqual(['100000', '100000', '100000']);
  });

  it('sans lot, ne ventile rien', () => {
    const { parts } = ventiler(d('100000'), [], 'EGALITE');
    expect(parts).toEqual([]);
  });

  it('expose la part en pourcentage', () => {
    const { parts } = ventiler(d('1000000'), lots, 'QUOTE_PART_PPE');
    expect(parts[2]!.partPct.equals(d('40'))).toBe(true);
  });
});
