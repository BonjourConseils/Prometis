import { Prisma } from '@prisma/client';

/**
 * Agrégation du fil rouge financier sur l'arbre CFC.
 *
 * Un poste CFC porte des montants qui lui sont **directement** rattachés, et
 * un total qui inclut ses descendants. Les deux sont exposés : un promoteur
 * qui voit « 3 640 000 » sur le poste 2 doit pouvoir savoir si c'est du
 * budget saisi là, ou la somme de ses sous-postes.
 *
 * Fonctions pures, tout en `Decimal`, testables sans base.
 */

const ZERO = new Prisma.Decimal(0);

/** Les cinq colonnes du fil rouge, plus le payé. */
export interface Colonnes {
  /** Première version de budget de l'opération — la référence figée. */
  budgeteInitial: Prisma.Decimal;
  /** Version courante : budget « au dernier connu ». */
  budgeteRevise: Prisma.Decimal;
  adjuge: Prisma.Decimal;
  /** Contrats + avenants signés (+ ou −). */
  commande: Prisma.Decimal;
  /** Factures validées, hors taxe — comme le budget. */
  facture: Prisma.Decimal;
  paye: Prisma.Decimal;
}

export interface MontantsNoeud extends Partial<Colonnes> {
  cfcNodeId: number;
}

export interface NoeudSource {
  id: number;
  parentId: number | null;
  code: string;
  libelle: string;
  niveau: number;
  ordre: number;
}

export interface NoeudCfc {
  id: number;
  parentId: number | null;
  code: string;
  libelle: string;
  niveau: number;
  /** Montants saisis sur ce poste précis. */
  propre: Colonnes;
  /** Montants du poste et de tous ses descendants. */
  total: Colonnes;
  /** Révisé − commandé : ce qu'il reste à adjuger. */
  resteAEngager: Prisma.Decimal;
  /** Commandé − facturé : ce qu'il reste à dépenser sur l'engagé. */
  resteADepenser: Prisma.Decimal;
  /** Révisé − initial : la dérive du budget depuis la référence. */
  ecartRevisionInitial: Prisma.Decimal;
  /** Révisé − facturé : négatif = dépassement. */
  ecartBudgetFacture: Prisma.Decimal;
  enfants: NoeudCfc[];
}

const colonnesVides = (): Colonnes => ({
  budgeteInitial: ZERO,
  budgeteRevise: ZERO,
  adjuge: ZERO,
  commande: ZERO,
  facture: ZERO,
  paye: ZERO,
});

const additionner = (a: Colonnes, b: Colonnes): Colonnes => ({
  budgeteInitial: a.budgeteInitial.plus(b.budgeteInitial),
  budgeteRevise: a.budgeteRevise.plus(b.budgeteRevise),
  adjuge: a.adjuge.plus(b.adjuge),
  commande: a.commande.plus(b.commande),
  facture: a.facture.plus(b.facture),
  paye: a.paye.plus(b.paye),
});

/**
 * Construit l'arbre et remonte les montants des feuilles vers la racine.
 *
 * Les nœuds orphelins — dont le parent a disparu — sont **remontés à la
 * racine** plutôt qu'ignorés : un poste budgété qui n'apparaît nulle part
 * fausserait silencieusement le total de l'opération.
 */
export function construireArbreCfc(
  noeuds: NoeudSource[],
  montants: MontantsNoeud[],
): { arbre: NoeudCfc[]; total: Colonnes } {
  const propreParNoeud = new Map<number, Colonnes>();
  for (const m of montants) {
    const actuel = propreParNoeud.get(m.cfcNodeId) ?? colonnesVides();
    propreParNoeud.set(m.cfcNodeId, {
      budgeteInitial: actuel.budgeteInitial.plus(m.budgeteInitial ?? ZERO),
      budgeteRevise: actuel.budgeteRevise.plus(m.budgeteRevise ?? ZERO),
      adjuge: actuel.adjuge.plus(m.adjuge ?? ZERO),
      commande: actuel.commande.plus(m.commande ?? ZERO),
      facture: actuel.facture.plus(m.facture ?? ZERO),
      paye: actuel.paye.plus(m.paye ?? ZERO),
    });
  }

  const ids = new Set(noeuds.map((n) => n.id));
  const enfantsDe = new Map<number | null, NoeudSource[]>();
  for (const n of noeuds) {
    // Parent absent de l'ensemble : on rattache à la racine.
    const cle = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
    enfantsDe.set(cle, [...(enfantsDe.get(cle) ?? []), n]);
  }

  const trier = (liste: NoeudSource[]) =>
    [...liste].sort((a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code, 'fr'));

  const construire = (source: NoeudSource): NoeudCfc => {
    const enfants = trier(enfantsDe.get(source.id) ?? []).map(construire);
    const propre = propreParNoeud.get(source.id) ?? colonnesVides();
    const total = enfants.reduce((acc, e) => additionner(acc, e.total), propre);

    return {
      id: source.id,
      parentId: source.parentId,
      code: source.code,
      libelle: source.libelle,
      niveau: source.niveau,
      propre,
      total,
      resteAEngager: total.budgeteRevise.minus(total.commande),
      resteADepenser: total.commande.minus(total.facture),
      ecartRevisionInitial: total.budgeteRevise.minus(total.budgeteInitial),
      ecartBudgetFacture: total.budgeteRevise.minus(total.facture),
      enfants,
    };
  };

  const arbre = trier(enfantsDe.get(null) ?? []).map(construire);
  const total = arbre.reduce((acc, n) => additionner(acc, n.total), colonnesVides());

  return { arbre, total };
}

// =====================================================================
//  Ventilation d'un montant sur les lots
// =====================================================================

export type CleVentilation = 'QUOTE_PART_PPE' | 'SURFACE' | 'EGALITE';

export interface LotVentilable {
  id: number;
  reference: string;
  quotePartPPE: Prisma.Decimal | null;
  surfaceM2: Prisma.Decimal | null;
}

export interface PartVentilee {
  lotId: number;
  reference: string;
  /** Part relative, en pourcentage du montant ventilé. */
  partPct: Prisma.Decimal;
  montant: Prisma.Decimal;
}

function poids(lot: LotVentilable, cle: CleVentilation): Prisma.Decimal {
  switch (cle) {
    case 'QUOTE_PART_PPE':
      return lot.quotePartPPE ?? ZERO;
    case 'SURFACE':
      return lot.surfaceM2 ?? ZERO;
    case 'EGALITE':
      return new Prisma.Decimal(1);
  }
}

/**
 * Répartit un montant sur des lots selon une clé.
 *
 * L'arrondi au centime crée toujours un résidu : 1 000 000 sur 3 lots à
 * égalité donne 333 333.33 × 3 = 999 999.99. Le résidu est absorbé par le
 * dernier lot pour que **la somme des parts égale exactement le montant
 * ventilé** — un budget qui ne se referme pas au centime est un budget qu'on
 * ne peut pas rapprocher.
 *
 * Si tous les poids sont nuls (aucune quote-part saisie, par exemple), on
 * retombe sur une répartition égalitaire plutôt que de tout mettre à zéro :
 * une ventilation vide serait un piège silencieux.
 */
export function ventiler(
  montantTotal: Prisma.Decimal,
  lots: LotVentilable[],
  cle: CleVentilation,
): { parts: PartVentilee[]; cleEffective: CleVentilation } {
  if (lots.length === 0) return { parts: [], cleEffective: cle };

  let cleEffective = cle;
  let poidsLots = lots.map((lot) => poids(lot, cle));
  let sommePoids = poidsLots.reduce<Prisma.Decimal>((t, p) => t.plus(p), ZERO);

  if (sommePoids.isZero()) {
    cleEffective = 'EGALITE';
    poidsLots = lots.map(() => new Prisma.Decimal(1));
    sommePoids = new Prisma.Decimal(lots.length);
  }

  const parts: PartVentilee[] = lots.map((lot, i) => {
    const part = poidsLots[i]!.dividedBy(sommePoids);
    return {
      lotId: lot.id,
      reference: lot.reference,
      partPct: part.times(100).toDecimalPlaces(4),
      montant: montantTotal.times(part).toDecimalPlaces(2),
    };
  });

  const somme = parts.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO);
  const residu = montantTotal.minus(somme);
  if (!residu.isZero()) {
    const dernier = parts.length - 1;
    parts[dernier] = { ...parts[dernier]!, montant: parts[dernier]!.montant.plus(residu) };
  }

  return { parts, cleEffective };
}
