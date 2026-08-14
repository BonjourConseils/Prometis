import { Prisma } from '@prisma/client';

/**
 * Lecture des champs d'une facture depuis son texte.
 *
 * ⚠️ **Ceci n'est pas de l'OCR.** L'extraction d'un PDF vers du texte est
 * déléguée à un service tiers, qui n'est pas encore choisi — la contrainte
 * nLPD pèse sur ce choix. Ce module part du **texte déjà extrait** et en tire
 * les champs métier : c'est la moitié du travail qui nous appartient, et elle
 * est testable sans dépendance externe.
 *
 * Toutes les valeurs sont des *propositions*. Rien n'écrase une saisie
 * humaine, et rien n'est imputé sans validation.
 */

export interface ChampsExtraits {
  numero: string | null;
  dateFacture: Date | null;
  montantHT: Prisma.Decimal | null;
  tvaPct: Prisma.Decimal | null;
  montantTTC: Prisma.Decimal | null;
  referenceQR: string | null;
  fournisseurNom: string | null;
}

/**
 * Convertit un montant écrit à la suisse en Decimal.
 * « 12'450.80 », « 12 450,80 », « 12450.80 » → 12450.80
 */
export function lireMontant(brut: string): Prisma.Decimal | null {
  const nettoye = brut
    // Séparateurs de milliers suisses : apostrophe typographique, apostrophe
    // droite, accent grave, et toute espace — `\s` couvre déjà l'espace
    // insécable et l'espace fine insécable.
    .replace(/[’'`\s]/g, '')
    .replace(/CHF|FR\.?/gi, '')
    .replace(/,/g, '.')
    .trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(nettoye)) return null;
  try {
    return new Prisma.Decimal(nettoye);
  } catch {
    return null;
  }
}

/** Dates suisses : 12.08.2026, 12/08/2026, 2026-08-12. */
export function lireDate(brut: string): Date | null {
  const jma = brut.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (jma) {
    const [, j, m, a] = jma;
    const date = new Date(Date.UTC(Number(a), Number(m) - 1, Number(j)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = brut.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[0]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const APRES_ETIQUETTE = (etiquettes: string[]): RegExp =>
  new RegExp(`(?:${etiquettes.join('|')})\\s*[:\\s]\\s*([^\\n]{1,40})`, 'i');

function premiereCapture(texte: string, motif: RegExp): string | null {
  const m = texte.match(motif);
  return m?.[1]?.trim() ?? null;
}

/**
 * Référence QR suisse : 27 chiffres, souvent groupés par blocs.
 * C'est la clé de rapprochement bancaire la plus fiable dont on dispose.
 */
export function lireReferenceQR(texte: string): string | null {
  const candidat = texte.match(/\b(?:\d[\s]?){26}\d\b/);
  if (!candidat) return null;
  const chiffres = candidat[0].replace(/\s/g, '');
  return chiffres.length === 27 ? chiffres : null;
}

export function extraireChamps(texte: string): ChampsExtraits {
  const lignes = texte
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const numero = premiereCapture(
    texte,
    APRES_ETIQUETTE([
      'facture\\s*n[°o]',
      'n[°o]\\s*de\\s*facture',
      'invoice\\s*no',
      'rechnung\\s*nr',
    ]),
  );

  const dateBrute = premiereCapture(
    texte,
    APRES_ETIQUETTE(['date\\s*de\\s*facture', 'date', 'datum']),
  );

  const htBrut = premiereCapture(
    texte,
    APRES_ETIQUETTE(['total\\s*ht', 'montant\\s*ht', 'sous-total', 'net\\s*ht']),
  );
  const ttcBrut = premiereCapture(
    texte,
    APRES_ETIQUETTE(['total\\s*ttc', 'montant\\s*ttc', 'total\\s*à\\s*payer', 'total\\s*general']),
  );
  const tvaBrut = premiereCapture(texte, /tva\s*(?:\(|à|:)?\s*(\d{1,2}[.,]\d{1,2})\s*%/i);

  const montantHT = htBrut ? lireMontant(htBrut) : null;
  const montantTTC = ttcBrut ? lireMontant(ttcBrut) : null;
  let tvaPct = tvaBrut ? lireMontant(tvaBrut) : null;

  // Taux déduit quand HT et TTC sont là mais pas le taux : mieux vaut le
  // calculer que de laisser un champ vide que quelqu'un remplira au jugé.
  if (!tvaPct && montantHT && montantTTC && !montantHT.isZero()) {
    const deduit = montantTTC.minus(montantHT).dividedBy(montantHT).times(100).toDecimalPlaces(2);
    if (deduit.greaterThan(0) && deduit.lessThan(30)) tvaPct = deduit;
  }

  return {
    numero: numero?.replace(/[.,;]$/, '') ?? null,
    dateFacture: dateBrute ? lireDate(dateBrute) : lireDate(texte),
    montantHT,
    tvaPct,
    montantTTC,
    referenceQR: lireReferenceQR(texte),
    // Heuristique volontairement simple : l'en-tête d'une facture porte le
    // nom de l'émetteur. Le rapprochement se fait ensuite par comparaison au
    // répertoire des entreprises, pas sur cette seule ligne.
    fournisseurNom: lignes[0] ?? null,
  };
}
