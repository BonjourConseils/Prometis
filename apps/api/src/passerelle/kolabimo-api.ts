import { z } from 'zod';

/**
 * Ce que l'API v1 de Kolabimo renvoie réellement — relevé dans son code
 * (`ImmoCollab/src/routes/api/v1/*.js`, version 1.3.20), pas dans une page de
 * documentation.
 *
 * La précaution a payé : la documentation de juillet décrivait des routes que
 * la 1.3 a changées, et le client écrit au Lot 7 appelait
 * `/promotions/:id/reservations`, qui n'a jamais existé.
 *
 * Validé par zod à la frontière, comme toute entrée : une réponse qui change
 * de forme doit échouer ici, avec son chemin, et pas trois fonctions plus
 * loin sous la forme d'un `undefined` dans un montant.
 */

const nombreOuNul = z.number().nullable().optional();
const date = z.coerce.date().nullable().optional();

/** `GET /api/v1/me` — la société résolue par la clé. */
export const moiSchema = z.object({
  type: z.string(),
  id: z.number().int(),
  nom: z.string(),
  email: z.string().nullable().optional(),
});

/** `GET /api/v1/promotions` — celles du périmètre de la clé. */
export const promotionsSchema = z.object({
  count: z.number().int(),
  promotions: z.array(
    z.object({
      id: z.number().int(),
      nom: z.string(),
      statut: z.string().nullable().optional(),
      localisation: z.string().nullable().optional(),
      photoUrl: z.string().nullable().optional(),
      promoteur: z.object({ id: z.number().int(), nom: z.string() }).nullable().optional(),
    }),
  ),
});

/**
 * `GET /api/v1/promotions/:id/lots` — les décimaux arrivent en NOMBRES.
 *
 * On les reconvertit en chaîne avant tout calcul (`versDecimal`) : un prix de
 * lot ne doit jamais faire un aller-retour par un flottant chez nous.
 */
export const lotsSchema = z.object({
  promotionId: z.number().int(),
  promotionNom: z.string(),
  promotionStatut: z.string().nullable().optional(),
  promotionLocalisation: z.string().nullable().optional(),
  promoteurId: z.number().int().nullable().optional(),
  promoteurNom: z.string().nullable().optional(),
  count: z.number().int(),
  lots: z.array(
    z.object({
      id: z.number().int(),
      reference: z.string(),
      immeubleId: z.number().int(),
      immeubleNom: z.string(),
      etage: z.number().int().nullable().optional(),
      nombrePieces: nombreOuNul,
      surfaceM2: nombreOuNul,
      prixVente: nombreOuNul,
      parkings: z.array(
        z.object({
          reference: z.string().nullable().optional(),
          type: z.string(),
          prix: nombreOuNul,
        }),
      ),
      prixTotalActe: nombreOuNul,
      statut: z.string(),
      statutEffectif: z.string().optional(),
      disponible: z.boolean().optional(),
    }),
  ),
});

/** `GET /api/v1/promotions/:id/echeancier` — Kolabimo en est maître depuis ACQ1. */
export const echeancierSchema = z.object({
  promotionId: z.number().int(),
  promotionNom: z.string(),
  totalPourcentage: z.number(),
  complet: z.boolean(),
  count: z.number().int(),
  etapes: z.array(
    z.object({
      id: z.number().int(),
      ordre: z.number().int(),
      libelle: z.string(),
      description: z.string().nullable().optional(),
      pourcentage: z.number(),
      statut: z.string(),
      dateCompletion: date,
      datePrevue: date,
    }),
  ),
});

/**
 * `GET /api/v1/reservations` — toutes celles des promotions du promoteur.
 *
 * **Sans identité**, jamais : ni nom ni e-mail, la seule `clientReference`.
 * L'identité ne passe que par le webhook du palier `FONDS_VERSES`. Une reprise
 * tirée ne peut donc pas rattraper l'identité d'un dossier déjà passé le
 * palier — c'est une limite du contrat, pas un oubli.
 *
 * `externalId` est NUL pour toute réservation posée dans l'interface de
 * Kolabimo : seules celles créées par l'API en portent un. La clé de
 * rapprochement est donc l'identifiant Kolabimo, pas `externalId`.
 */
export const reservationsSchema = z.array(
  z.object({
    id: z.number().int(),
    statut: z.string(),
    agenceId: z.number().int().nullable().optional(),
    clientReference: z.string().nullable().optional(),
    montantVersement: z.union([z.string(), z.number()]).nullable().optional(),
    dateVersement: date,
    dateSignature: date,
    externalId: z.string().nullable().optional(),
    createdAt: date,
    appartement: z
      .object({ id: z.number().int(), reference: z.string(), statut: z.string().optional() })
      .nullable()
      .optional(),
    agence: z.object({ id: z.number().int(), nom: z.string() }).nullable().optional(),
  }),
);

export type MoiKolabimo = z.infer<typeof moiSchema>;
export type PromotionsKolabimo = z.infer<typeof promotionsSchema>;
export type LotsKolabimo = z.infer<typeof lotsSchema>;
export type EcheancierKolabimo = z.infer<typeof echeancierSchema>;
export type ReservationsKolabimo = z.infer<typeof reservationsSchema>;

/**
 * Un nombre JSON vers la chaîne décimale qu'attend `Prisma.Decimal`.
 *
 * `toFixed(2)` et non `String()` : `String(0.1 + 0.2)` rend
 * « 0.30000000000000004 ». Kolabimo stocke des `Decimal(12,2)` ; deux
 * décimales sont exactement ce qu'il a voulu dire.
 */
export function versDecimal(valeur: number | null | undefined): string | null {
  return valeur === null || valeur === undefined ? null : valeur.toFixed(2);
}
