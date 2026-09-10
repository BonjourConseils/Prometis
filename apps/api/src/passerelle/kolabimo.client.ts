import { Injectable, Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { loadEnv, type Env } from '../config/env';
import { ENTETE_CLE_API } from './signature';
import {
  echeancierSchema,
  lotsSchema,
  moiSchema,
  promotionsSchema,
  reservationsSchema,
  type EcheancierKolabimo,
  type LotsKolabimo,
  type MoiKolabimo,
  type PromotionsKolabimo,
  type ReservationsKolabimo,
} from './kolabimo-api';

/** De quoi parler à Kolabimo au nom d'UNE société. */
export interface AccesKolabimo {
  baseUrl: string;
  cle: string;
}

export type Lecture<T> =
  { ok: true; donnees: T } | { ok: false; statutHttp?: number; raison: string };

export interface ResultatLivraison {
  livre: boolean;
  statutHttp?: number;
  raison?: string;
}

/**
 * Client de l'API v1 de Kolabimo.
 *
 * **Il ne connaît aucune clé.** Chaque appel reçoit l'accès de la société au
 * nom de laquelle il parle — c'est la conséquence directe de SEC1 : depuis
 * Kolabimo 1.3.0, une clé est cloisonnée à un promoteur. Une clé d'instance,
 * comme au Lot 7, aurait fait lire à un promoteur les promotions d'un autre.
 *
 * **Un appel ne lève jamais.** Il rend `{ ok: false, raison }` : Kolabimo
 * indisponible ne doit faire échouer ni un écran ni un geste métier.
 */
@Injectable()
export class KolabimoClient {
  private readonly logger = new Logger(KolabimoClient.name);
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  /** Qui est derrière cette clé — sert au bouton « Tester la connexion ». */
  moi(acces: AccesKolabimo): Promise<Lecture<MoiKolabimo>> {
    return this.lire(acces, '/api/v1/me', moiSchema);
  }

  promotions(acces: AccesKolabimo): Promise<Lecture<PromotionsKolabimo>> {
    return this.lire(acces, '/api/v1/promotions', promotionsSchema);
  }

  lots(acces: AccesKolabimo, promotionId: number): Promise<Lecture<LotsKolabimo>> {
    return this.lire(acces, `/api/v1/promotions/${promotionId}/lots`, lotsSchema);
  }

  echeancier(acces: AccesKolabimo, promotionId: number): Promise<Lecture<EcheancierKolabimo>> {
    return this.lire(acces, `/api/v1/promotions/${promotionId}/echeancier`, echeancierSchema);
  }

  /**
   * Les réservations de TOUTES les promotions du promoteur : l'API n'a pas de
   * filtre par promotion. C'est à l'appelant de ne garder que les siennes, par
   * les appartements de la promotion.
   */
  reservations(acces: AccesKolabimo): Promise<Lecture<ReservationsKolabimo>> {
    return this.lire(acces, '/api/v1/reservations', reservationsSchema);
  }

  /**
   * Les encaissements vers la trésorerie de Kolabimo — **sans destinataire**.
   *
   * La page Passerelle prévoit ce sens, mais Kolabimo n'expose aucune route
   * pour les recevoir (relevé dans son code, version 1.3.20). Plutôt que de
   * poster dans le vide et remplir le journal de 404, on le dit : l'événement
   * reste en boîte d'envoi, rejouable le jour où la route existera.
   */
  publierEvenement(): Promise<ResultatLivraison> {
    return Promise.resolve({
      livre: false,
      raison:
        'Réception des encaissements non configurée côté Kolabimo : aucune route ne les ' +
        "reçoit encore. L'événement reste en boîte d'envoi.",
    });
  }

  private async lire<T>(
    acces: AccesKolabimo,
    chemin: string,
    schema: ZodType<T>,
  ): Promise<Lecture<T>> {
    const url = `${acces.baseUrl.replace(/\/+$/, '')}${chemin}`;
    try {
      const reponse = await fetch(url, {
        headers: { [ENTETE_CLE_API]: acces.cle, accept: 'application/json' },
        signal: AbortSignal.timeout(this.env.KOLABIMO_TIMEOUT_MS),
      });
      const texte = await reponse.text();

      if (!reponse.ok) {
        return {
          ok: false,
          statutHttp: reponse.status,
          raison: raisonLisible(reponse.status, texte),
        };
      }

      let json: unknown;
      try {
        json = JSON.parse(texte);
      } catch {
        return {
          ok: false,
          statutHttp: reponse.status,
          raison: 'Kolabimo a répondu autre chose que du JSON.',
        };
      }

      const analyse = schema.safeParse(json);
      if (!analyse.success) {
        const detail = analyse.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
          .join(' · ');
        this.logger.error(`Réponse Kolabimo inattendue sur ${chemin} — ${detail}`);
        return {
          ok: false,
          statutHttp: reponse.status,
          raison: `Réponse Kolabimo inattendue — ${detail}`,
        };
      }
      return { ok: true, donnees: analyse.data };
    } catch (erreur) {
      const raison = erreur instanceof Error ? erreur.message : 'Appel impossible';
      this.logger.warn(`Kolabimo injoignable (GET ${chemin}) : ${raison}`);
      return { ok: false, raison: `Kolabimo injoignable : ${raison}` };
    }
  }
}

/**
 * Traduit un code HTTP de Kolabimo en phrase utile.
 *
 * Hors périmètre, Kolabimo répond 404 et non 403 (SEC1 : ne pas confirmer
 * qu'une promotion existe chez un concurrent). Un 404 sur une promotion veut
 * donc souvent dire « pas la vôtre » — le message le dit.
 */
function raisonLisible(statut: number, texte: string): string {
  let message = texte.slice(0, 200);
  try {
    const corps = JSON.parse(texte) as { error?: string };
    if (corps.error) message = corps.error;
  } catch {
    // Corps non JSON : on garde l'extrait brut.
  }
  if (statut === 401)
    return `Clé refusée par Kolabimo (${message}). Vérifiez-la, ou régénérez-la dans Kolabimo.`;
  if (statut === 403) return `Kolabimo refuse cette opération à ce type de clé (${message}).`;
  if (statut === 404)
    return `Introuvable chez Kolabimo — ou hors du périmètre de votre clé (${message}).`;
  return `Kolabimo a répondu ${statut} : ${message}`;
}
