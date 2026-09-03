import { z } from 'zod';
import { montantPositif } from '../common/zod-decimal';

/**
 * Le contrat de webhook publié par Kolabimo (branche `sec1-cloisonnement-api-v1`,
 * version 1.3.0), traduit vers la forme interne de la passerelle.
 *
 * Ce fichier existe parce que les deux produits ne parlaient pas la même
 * langue. Prometis attendait une enveloppe `{ evenement, idEvenement, emisLe,
 * donnees }` signée « t=…,v1=… » ; Kolabimo émet des en-têtes
 * `X-Kolabimo-Event` / `-Delivery` / `-Signature`, une signature hexadécimale
 * nue, et un corps où la charge est nommée d'après son sujet (`reservation`,
 * `etape`). Sans traduction, **aucun** webhook réel ne serait passé : rejeté à
 * la signature, et illisible s'il l'avait franchie.
 *
 * On accepte donc les deux formes. La nôtre reste celle du fil sortant et des
 * tests ; celle de Kolabimo est la seule qui circulera en production.
 */

/** En-têtes du contrat Kolabimo. */
export const ENTETE_EVENEMENT = 'x-kolabimo-event';
export const ENTETE_LIVRAISON = 'x-kolabimo-delivery';

/**
 * Une personne du dossier acquéreur.
 *
 * Tout est facultatif sauf le rôle : Kolabimo ne livre l'identité qu'au palier
 * `FONDS_VERSES`, et même à ce moment-là une société n'a ni prénom ni date de
 * naissance. Exiger un nom ferait échouer l'événement qui apporte justement
 * l'identité.
 */
export const personneSchema = z.object({
  role: z.string().trim().min(1).max(60),
  type: z.string().trim().min(1).max(40).nullish(),
  nom: z.string().trim().max(200).nullish(),
  prenom: z.string().trim().max(200).nullish(),
  email: z.string().trim().email('Adresse e-mail invalide.').nullish(),
  telephone: z.string().trim().max(60).nullish(),
  dateNaissance: z.coerce.date().nullish(),
  nationalite: z.string().trim().max(80).nullish(),
  adresse: z.string().trim().max(300).nullish(),
  npa: z.string().trim().max(20).nullish(),
  localite: z.string().trim().max(120).nullish(),
  pays: z.string().trim().max(80).nullish(),
  /** Quote-part en **fraction** — « 1/2 », « 1/3 ». Jamais un pourcentage. */
  quotePart: z.string().trim().max(20).nullish(),
  raisonSociale: z.string().trim().max(200).nullish(),
  ide: z.string().trim().max(40).nullish(),
  signataire: z.boolean().nullish(),
});

/**
 * Le bloc `client`.
 *
 * Avant `FONDS_VERSES` il ne porte **que** la référence pseudonyme — pas un
 * nom vide, pas un e-mail nul : le champ est absent. C'est la garantie que
 * Prometis ne peut pas servir de porte de derrière pour lire, à `RESERVE`, ce
 * que Kolabimo cache encore au promoteur.
 */
export const clientKolabimoSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  niveau: z.string().trim().max(40).nullish(),
  regime: z.string().trim().max(60).nullish(),
  personnes: z.array(personneSchema).optional(),
});

export const corpsReservationSchema = z.object({
  id: z.number().int().positive().nullish(),
  externalId: z.string().trim().min(1).max(120),
  statut: z.string().trim().min(1),
  /**
   * Facultatif : le corps Kolabimo ne porte pas la promotion. On retrouve
   * l'opération par le lot, ce qui donne au passage le bon comportement pour
   * une promotion hors de notre périmètre — le lot n'existe pas, l'événement
   * est ignoré au lieu d'échouer.
   */
  promotionId: z.number().int().positive().nullish(),
  appartementId: z.number().int().positive(),
  bienRef: z.string().trim().max(120).nullish(),
  agenceId: z.number().int().positive().nullish(),
  agenceNom: z.string().trim().max(200).nullish(),
  prixTotalActe: montantPositif.nullish(),
  montantVersement: montantPositif.nullish(),
  dateReservation: z.coerce.date().nullish(),
  dateSignatureActe: z.coerce.date().nullish(),
  client: clientKolabimoSchema,
});

export const corpsEtapeSchema = z.object({
  promotion: z.object({
    id: z.number().int().positive(),
    nom: z.string().trim().max(200).nullish(),
  }),
  etape: z.object({
    id: z.number().int().positive(),
    ordre: z.number().int().nonnegative().nullish(),
    libelle: z.string().trim().max(200).nullish(),
    pourcentage: z.union([z.number(), z.string()]).nullish(),
    statut: z.string().trim().max(40).nullish(),
    dateCompletion: z.coerce.date().nullish(),
    datePrevue: z.coerce.date().nullish(),
  }),
});

export type PersonneKolabimo = z.infer<typeof personneSchema>;
export type CorpsReservation = z.infer<typeof corpsReservationSchema>;
export type CorpsEtape = z.infer<typeof corpsEtapeSchema>;

/** Forme interne, commune aux deux contrats. */
export interface EnveloppeNormalisee {
  evenement: string;
  idEvenement: string | null;
  emisLe: Date | null;
  donnees: unknown;
  /** Vrai quand la charge vient du contrat Kolabimo, pas du nôtre. */
  contratKolabimo: boolean;
}

const enveloppeInterne = z.object({
  evenement: z.string().trim().min(1).max(80),
  idEvenement: z.string().trim().min(1).max(120).nullish(),
  emisLe: z.coerce.date().nullish(),
  donnees: z.unknown(),
});

const enveloppeKolabimo = z.object({
  event: z.string().trim().min(1).max(80),
  delivery: z.string().trim().min(1).max(200).nullish(),
  emisLe: z.coerce.date().nullish(),
  reservation: z.unknown().optional(),
  promotion: z.unknown().optional(),
  etape: z.unknown().optional(),
});

/**
 * Ramène une charge entrante à la forme interne, quel que soit son contrat.
 *
 * Les en-têtes priment sur le corps : `X-Kolabimo-Event` nomme l'événement et
 * `X-Kolabimo-Delivery` en est la clé de déduplication. C'est ce que Kolabimo
 * promet d'unique par événement — plus fiable que l'empreinte d'un corps
 * re-sérialisé.
 */
export function normaliser(
  corps: unknown,
  entetes: { evenement?: string; livraison?: string } = {},
): EnveloppeNormalisee {
  const kolabimo = enveloppeKolabimo.safeParse(corps);
  if (kolabimo.success && (entetes.evenement || kolabimo.data.event)) {
    const donnees =
      kolabimo.data.reservation ??
      (kolabimo.data.etape !== undefined
        ? { promotion: kolabimo.data.promotion, etape: kolabimo.data.etape }
        : undefined);
    if (donnees !== undefined) {
      return {
        evenement: entetes.evenement ?? kolabimo.data.event,
        idEvenement: entetes.livraison ?? kolabimo.data.delivery ?? null,
        emisLe: kolabimo.data.emisLe ?? null,
        donnees,
        contratKolabimo: true,
      };
    }
  }

  const interne = enveloppeInterne.parse(corps);
  return {
    evenement: entetes.evenement ?? interne.evenement,
    idEvenement: entetes.livraison ?? interne.idEvenement ?? null,
    emisLe: interne.emisLe ?? null,
    donnees: interne.donnees,
    contratKolabimo: false,
  };
}
