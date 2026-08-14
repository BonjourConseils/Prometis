import { Prisma, type ReservationStatut } from '@prisma/client';
import { z } from 'zod';
import { montantPositif } from '../common/zod-decimal';

/**
 * Ce que Prometis accepte de Kolabimo, et ce qu'il refuse.
 *
 * Kolabimo est maître des lots, des prix et des réservations ; Prometis est
 * maître de l'échéancier et des appels de fonds. La frontière n'est pourtant
 * pas une simple recopie : dès qu'un appel de fonds est parti, l'assiette qui
 * l'a produit ne peut plus bouger, même à la demande de son propre maître.
 * Sinon la créance émise ne correspondrait plus à rien de traçable.
 *
 * Tout ce fichier est pur : aucune base, aucun réseau. C'est là que sont les
 * règles, donc c'est là que portent les tests.
 */

// =====================================================================
//  Charges entrantes
// =====================================================================

const texte = z.string().trim().min(1).max(500).nullish();

export const clientSchema = z.object({
  ref: z.string().trim().min(1).max(120),
  nom: texte,
  prenom: texte,
  email: z.string().trim().email('Adresse e-mail invalide.').nullish(),
  telephone: texte,
  adresse: texte,
});

export const reservationSchema = z.object({
  /** Identifiant stable partagé : c'est lui qui porte la réconciliation. */
  externalId: z.string().trim().min(1).max(120),
  reservationId: z.number().int().positive().nullish(),
  promotionId: z.number().int().positive(),
  appartementId: z.number().int().positive(),
  statut: z.string().trim().min(1),
  prixTotalActe: montantPositif.nullish(),
  dateReservation: z.coerce.date().nullish(),
  dateSignatureActe: z.coerce.date().nullish(),
  client: clientSchema,
});

export const lotSchema = z.object({
  promotionId: z.number().int().positive(),
  appartementId: z.number().int().positive(),
  prixVente: montantPositif.nullish(),
  parkings: z
    .array(z.object({ parkingId: z.number().int().positive(), prix: montantPositif.nullish() }))
    .optional(),
});

/** Enveloppe commune à tous les webhooks Kolabimo. */
export const enveloppeSchema = z.object({
  evenement: z.string().trim().min(1).max(80),
  /**
   * Identifiant de l'événement chez l'émetteur. Facultatif parce qu'on ne
   * maîtrise pas l'émetteur, mais c'est lui qui rend le dédoublonnage fiable
   * (cf. `construireDedupeKey`).
   */
  idEvenement: z.string().trim().min(1).max(120).nullish(),
  emisLe: z.coerce.date().nullish(),
  donnees: z.unknown(),
});

export type DonneesReservation = z.infer<typeof reservationSchema>;
export type DonneesLot = z.infer<typeof lotSchema>;

// =====================================================================
//  Statuts
// =====================================================================

/**
 * `ReservationStatut` ne fait pas partie des enums explicitement alignés avec
 * Kolabimo. On traduit donc, en acceptant les graphies plausibles — mais un
 * statut inconnu lève : le prendre pour un OPTION ferait disparaître une vente
 * de l'assiette des appels de fonds sans que personne ne le voie.
 */
const STATUTS: Record<string, ReservationStatut> = {
  option: 'OPTION',
  optionnee: 'OPTION',
  reserve: 'RESERVE',
  reservee: 'RESERVE',
  reservation: 'RESERVE',
  fonds_verses: 'FONDS_VERSES',
  fondsverses: 'FONDS_VERSES',
  acompte_verse: 'FONDS_VERSES',
  vendu: 'VENDU',
  vendue: 'VENDU',
  acte_signe: 'VENDU',
  expire: 'EXPIREE',
  expiree: 'EXPIREE',
  annule: 'ANNULEE',
  annulee: 'ANNULEE',
  desiste: 'ANNULEE',
};

export function statutDepuisKolabimo(brut: string): ReservationStatut {
  const cle = brut
    .normalize('NFD')
    // Marques diacritiques combinantes, écrites en échappement : les coller
    // en clair dans une classe de caractères les rend invisibles à la relecture.
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const statut = STATUTS[cle];
  if (!statut) {
    throw new Error(
      `Statut de réservation inconnu côté Kolabimo : « ${brut} ». ` +
        `Ajouter la correspondance plutôt que de deviner.`,
    );
  }
  return statut;
}

/** Statuts qui engagent l'acquéreur, donc qui portent des appels de fonds. */
const ENGAGES: ReservationStatut[] = ['RESERVE', 'FONDS_VERSES', 'VENDU'];

export function estEngage(statut: ReservationStatut): boolean {
  return ENGAGES.includes(statut);
}

// =====================================================================
//  Ce qui peut encore changer
// =====================================================================

export interface EtatReservation {
  statut: ReservationStatut;
  prixTotalActe: Prisma.Decimal | null;
  dateSignatureActe: Date | null;
  /** Appels de fonds déjà émis sur cette réservation (annulés exclus). */
  appelsEmis: number;
}

/**
 * Un champ volontairement non appliqué, avec sa raison.
 *
 * Alias de type et non `interface` : TypeScript n'accorde de signature d'index
 * implicite qu'aux premiers, et sans elle un `Refus[]` n'entre pas dans le
 * `Json` de la piste d'audit.
 */
export type Refus = { champ: string; raison: string };

export interface PlanMiseAJour {
  /** Champs à appliquer tels quels. */
  champs: {
    statut?: ReservationStatut;
    prixTotalActe?: Prisma.Decimal;
    dateSignatureActe?: Date | null;
    kolabimoReservationId?: number;
  };
  /** Champs volontairement laissés de côté, avec la raison — affichée au journal. */
  refus: Refus[];
  /**
   * Renseigné quand l'événement ne peut pas être appliqué du tout et demande
   * une intervention humaine. L'événement est alors marqué en erreur : mieux
   * vaut une alerte visible qu'une donnée financière modifiée en douce.
   */
  bloquant?: string;
}

/**
 * Décide ce qu'une charge Kolabimo a le droit de modifier sur une réservation
 * qui existe déjà chez nous.
 *
 * Deux verrous, tous deux financiers :
 *
 *   1. **Le prix total acte est figé** dès la signature de l'acte ou dès le
 *      premier appel de fonds. Le laisser bouger changerait rétroactivement
 *      l'assiette de créances déjà envoyées à un acquéreur.
 *   2. **Une annulation n'est pas automatique** si des appels sont partis.
 *      Une créance émise ne s'efface pas d'un webhook : il faut un
 *      remboursement, un avoir ou un accord — donc un humain.
 */
export function planifierMiseAJour(
  existante: EtatReservation,
  entrant: DonneesReservation,
): PlanMiseAJour {
  const plan: PlanMiseAJour = { champs: {}, refus: [] };

  if (entrant.reservationId) plan.champs.kolabimoReservationId = entrant.reservationId;

  const statutEntrant = statutDepuisKolabimo(entrant.statut);
  const fige = existante.appelsEmis > 0 || existante.dateSignatureActe !== null;

  if (statutEntrant === 'ANNULEE' && existante.appelsEmis > 0) {
    return {
      champs: {},
      refus: [],
      bloquant:
        `Annulation refusée : ${existante.appelsEmis} appel(s) de fonds déjà émis sur cette ` +
        `réservation. Traiter le remboursement ou l'avoir, puis annuler dans Prometis.`,
    };
  }

  if (statutEntrant !== existante.statut) plan.champs.statut = statutEntrant;

  if (entrant.prixTotalActe) {
    const identique = existante.prixTotalActe?.equals(entrant.prixTotalActe) ?? false;
    if (identique) {
      // Rien à faire : ne pas l'inscrire en refus, ce serait du bruit dans le journal.
    } else if (fige) {
      plan.refus.push({
        champ: 'prixTotalActe',
        raison:
          `Prix figé (${existante.prixTotalActe?.toFixed(2) ?? '—'} CHF) : ` +
          (existante.appelsEmis > 0
            ? `${existante.appelsEmis} appel(s) de fonds en découlent.`
            : "l'acte est signé.") +
          ` Valeur reçue ignorée : ${entrant.prixTotalActe.toFixed(2)} CHF.`,
      });
    } else {
      plan.champs.prixTotalActe = entrant.prixTotalActe;
    }
  }

  if (entrant.dateSignatureActe !== undefined) {
    const nouvelle = entrant.dateSignatureActe ?? null;
    const ancienne = existante.dateSignatureActe;
    const memeDate = nouvelle?.getTime() === ancienne?.getTime();
    if (!memeDate) {
      if (ancienne !== null && nouvelle === null) {
        // Dé-signer un acte n'existe pas : c'est une résiliation, pas une correction.
        plan.refus.push({
          champ: 'dateSignatureActe',
          raison: "L'acte est déjà signé : sa date ne peut pas être effacée.",
        });
      } else {
        plan.champs.dateSignatureActe = nouvelle;
      }
    }
  }

  return plan;
}

/**
 * Prix total acte d'un lot = prix du lot + Σ prix des parkings (CLAUDE.md §5).
 *
 * Kolabimo le calcule déjà et le transmet ; on le recalcule quand même quand
 * il manque, pour ne pas dépendre d'un champ facultatif chez l'émetteur.
 */
export function calculerPrixTotalDepuisLot(
  prixLot: Prisma.Decimal | null,
  prixParkings: (Prisma.Decimal | null)[],
): Prisma.Decimal | null {
  if (!prixLot) return null;
  return prixParkings.reduce<Prisma.Decimal>(
    (total, prix) => (prix ? total.plus(prix) : total),
    prixLot,
  );
}
