/**
 * Formatage suisse romand.
 *
 * Les montants arrivent de l'API en **chaînes** — ils viennent de `Decimal`
 * côté serveur, et les convertir en nombre JavaScript avant affichage
 * réintroduirait l'imprécision qu'on a pris soin d'éviter en base. On ne
 * convertit qu'au tout dernier moment, pour l'affichage.
 */

const CHF = new Intl.NumberFormat('fr-CH', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DECIMAL = new Intl.NumberFormat('fr-CH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/** « 12180000 » → « 12 180 000 CHF ». */
export function chf(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const n = Number(valeur);
  return Number.isFinite(n) ? `${CHF.format(n)} CHF` : '—';
}

/** Sans l'unité, pour les tableaux où la colonne la porte déjà. */
export function montant(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const n = Number(valeur);
  return Number.isFinite(n) ? CHF.format(n) : '—';
}

/** Surfaces, millièmes, nombres de pièces. */
export function nombre(valeur: string | number | null | undefined, unite = ''): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  return unite ? `${DECIMAL.format(n)} ${unite}` : DECIMAL.format(n);
}

export function pourcentage(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined) return '—';
  const n = Number(valeur);
  return Number.isFinite(n) ? `${DECIMAL.format(n)} %` : '—';
}

export function date(valeur: string | null | undefined): string {
  if (!valeur) return '—';
  const d = new Date(valeur);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Libellés métier.
 *
 * Un simple `toLowerCase().replace('_',' ')` donne « corps detat separes » ou
 * « en attente notaire » : compréhensible, mais ce n'est pas la langue du
 * promoteur. Les termes du métier s'écrivent correctement.
 */
const LIBELLES: Record<string, string> = {
  // Statut d'opération
  MONTAGE: 'montage',
  EN_PREPARATION: 'en préparation',
  EN_CHANTIER: 'en chantier',
  EN_COMMERCIALISATION: 'en commercialisation',
  LIVRAISON: 'livraison',
  CLOTUREE: 'clôturée',
  // Mode de réalisation
  ENTREPRISE_GENERALE: 'entreprise générale',
  MANDAT_ARCHITECTE: "mandat d'architecte",
  CORPS_DETAT_SEPARES: "corps d'état séparés",
  // Statut de lot
  DISPONIBLE: 'disponible',
  RESERVE: 'réservé',
  EN_ATTENTE_NOTAIRE: 'en attente notaire',
  VENDU: 'vendu',
  // Nature de bien
  LOTISSEMENT: 'lotissement',
  VILLA: 'villa',
  IMMEUBLE: 'immeuble',
  CHALET: 'chalet',
  // Types d'acteur
  NOTAIRE: 'notaire',
  GEOMETRE: 'géomètre',
  INGENIEUR: 'ingénieur',
  ARCHITECTE: 'architecte',
  BUREAU_TECHNIQUE: 'bureau technique',
  COURTIER: 'courtier',
  MAITRE_OUVRAGE: "maître d'ouvrage",
  PILOTE: 'pilote',
  AUTRE: 'autre',
};

/** ENTREPRISE_GENERALE → « entreprise générale », CORPS_DETAT_SEPARES → « corps d'état séparés ». */
export function lisible(valeur: string | null | undefined): string {
  if (!valeur) return '—';
  return LIBELLES[valeur] ?? valeur.toLowerCase().replace(/_/g, ' ');
}

/** Libellés des groupes principaux CFC (norme CRB). */
export const GROUPES_CFC: Record<string, string> = {
  '0': 'Terrain',
  '1': 'Travaux préparatoires',
  '2': 'Bâtiment',
  '3': "Équipements d'exploitation",
  '4': 'Aménagements extérieurs',
  '5': 'Frais secondaires',
  '9': 'Ameublement',
};
