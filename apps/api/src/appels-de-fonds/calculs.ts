import { Prisma, type ReservationStatut } from '@prisma/client';

/**
 * Calculs des appels de fonds.
 *
 * `montant = pourcentage × prix total acte`. Le prix total acte est **figé
 * dans la réservation** (prix du lot + Σ parkings au moment de la vente) : on
 * ne le recalcule jamais depuis le lot, dont le prix peut avoir bougé depuis
 * la signature.
 */

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal(100);

/**
 * Réservations pour lesquelles un appel de fonds est dû.
 *
 * Une OPTION n'est pas un engagement : appeler des fonds sur une option
 * poserait une créance sur quelqu'un qui n'a rien signé. EXPIREE et ANNULEE
 * sortent évidemment.
 */
export const STATUTS_ENGAGES: ReservationStatut[] = ['RESERVE', 'FONDS_VERSES', 'VENDU'];

export const estEngagee = (statut: ReservationStatut): boolean => STATUTS_ENGAGES.includes(statut);

/** Montant d'un appel, arrondi au centime. */
export function calculerMontantAppel(
  pourcentage: Prisma.Decimal,
  prixTotalActe: Prisma.Decimal,
): Prisma.Decimal {
  return prixTotalActe.times(pourcentage).dividedBy(CENT).toDecimalPlaces(2);
}

/** Prix total acte d'un lot : prix de vente + Σ prix des parkings. */
export function calculerPrixTotalActe(
  prixVente: Prisma.Decimal | null,
  prixParkings: (Prisma.Decimal | null)[],
): Prisma.Decimal {
  return prixParkings.reduce<Prisma.Decimal>(
    (total, p) => (p ? total.plus(p) : total),
    prixVente ?? ZERO,
  );
}

// =====================================================================
//  Contrôle de l'échéancier
// =====================================================================

export interface EtapeEcheancier {
  id: number;
  ordre: number;
  libelle: string;
  pourcentage: Prisma.Decimal | null;
}

export interface ControleEcheancier {
  sommePourcentages: Prisma.Decimal;
  /** Σ des pourcentages non nuls = 100 %. */
  complet: boolean;
  ecart: Prisma.Decimal;
  nombreEtapesAppelantes: number;
  /** Jalons de suivi de chantier : aucun appel de fonds n'en découle. */
  nombreJalonsSuivi: number;
}

/**
 * Vérifie qu'un échéancier appelle bien 100 % du prix.
 *
 * Un échéancier à 95 % laisse 5 % qui ne seront jamais appelés — le promoteur
 * s'en aperçoit à la remise des clés, quand il est trop tard pour le corriger
 * proprement. L'écart est donc exposé, pas seulement un booléen.
 */
export function controlerEcheancier(etapes: EtapeEcheancier[]): ControleEcheancier {
  const appelantes = etapes.filter((e) => e.pourcentage !== null);
  const somme = appelantes.reduce<Prisma.Decimal>((t, e) => t.plus(e.pourcentage!), ZERO);

  return {
    sommePourcentages: somme,
    complet: somme.equals(CENT),
    ecart: somme.minus(CENT),
    nombreEtapesAppelantes: appelantes.length,
    nombreJalonsSuivi: etapes.length - appelantes.length,
  };
}

// =====================================================================
//  Suivi d'un appel de fonds
// =====================================================================

export interface EtatAppel {
  montantAppele: Prisma.Decimal;
  montantEncaisse: Prisma.Decimal;
  solde: Prisma.Decimal;
  soldé: boolean;
  partiellementPaye: boolean;
  /** Échéance dépassée et non soldé. */
  enRetard: boolean;
}

export function etatAppel(
  montant: Prisma.Decimal,
  encaissements: Prisma.Decimal[],
  dateEcheance: Date | null,
  maintenant: Date,
): EtatAppel {
  const encaisse = encaissements.reduce<Prisma.Decimal>((t, e) => t.plus(e), ZERO);
  const solde = montant.minus(encaisse);
  const soldé = encaisse.greaterThanOrEqualTo(montant);

  return {
    montantAppele: montant,
    montantEncaisse: encaisse,
    solde,
    soldé,
    partiellementPaye: encaisse.greaterThan(0) && !soldé,
    enRetard: !soldé && dateEcheance !== null && dateEcheance < maintenant,
  };
}

/** Numéro lisible d'un appel de fonds : « AF-2026-0042 ». */
export function numeroAppel(annee: number, id: number): string {
  return `AF-${annee}-${String(id).padStart(4, '0')}`;
}
