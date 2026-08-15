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
  // Catégories de documents — la GED les affiche en titre de section.
  ACTE_VENTE: 'acte de vente',
  EXTRAIT_RF: 'extrait du registre foncier',
  PPE_ACTE_CONSTITUTIF: 'acte constitutif de PPE',
  PPE_REGLEMENT: 'règlement de PPE',
  PPE_PLAN: 'plan de PPE',
  MANDAT_COURTAGE: 'mandat de courtage',
  PV_RECEPTION: 'PV de réception',
  PV_SEANCE: 'PV de séance',
  PHOTO_CHANTIER: 'photo de chantier',
  // Types et statuts de séance
  COPIL: 'comité de pilotage',
  CLIENT_ACQUEREUR: 'client acquéreur',
  PLANIFIEE: 'planifiée',
  TENUE: 'tenue',
  ANNULEE: 'annulée',
  OUVERT: 'ouvert',
  EN_COURS: 'en cours',
  CLOS: 'clos',
  // Courtage
  TOUTE_OPERATION: "toute l'opération",
  LOTS_SELECTIONNES: 'lots sélectionnés',
  POURCENTAGE: 'pourcentage',
  FORFAIT: 'forfait',
  BROUILLON: 'brouillon',
  SIGNE: 'signé',
  ACTIF: 'actif',
  TERMINE: 'terminé',
  RESILIE: 'résilié',
  DUE: 'due',
  FACTUREE: 'facturée',
  PAYEE: 'payée',
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
