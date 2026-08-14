import { Injectable, Logger } from '@nestjs/common';
import { loadEnv, type Env } from '../config/env';
import { ENTETE_CLE_API, ENTETE_SIGNATURE, signer } from './signature';

export interface ResultatLivraison {
  livre: boolean;
  statutHttp?: number;
  raison?: string;
}

/**
 * Client de l'API v1 de Kolabimo.
 *
 * Deux principes :
 *
 *   · **Non configuré n'est pas en panne.** Sans URL ni clé, le client le dit
 *     et ne tente rien. La boîte d'envoi garde l'événement ; le jour où les
 *     identifiants arrivent, un rejeu le livre. C'est ce qui permet de
 *     développer et de tester la passerelle entière sans compte Kolabimo.
 *   · **Un appel sortant ne fait jamais échouer une opération métier.** Les
 *     erreurs sont retournées, pas levées : Kolabimo indisponible ne doit pas
 *     empêcher un promoteur de clore un jalon de chantier.
 */
@Injectable()
export class KolabimoClient {
  private readonly logger = new Logger(KolabimoClient.name);
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get configure(): boolean {
    return Boolean(this.env.KOLABIMO_API_URL && this.env.KOLABIMO_API_KEY);
  }

  get description(): { configure: boolean; baseUrl: string | null } {
    return {
      configure: this.configure,
      baseUrl: this.env.KOLABIMO_API_URL || null,
    };
  }

  /**
   * Publie un événement sortant vers Kolabimo, signé comme les entrants.
   *
   * La clé d'API sert de secret de signature : c'est le miroir exact de ce que
   * Kolabimo fait avec la clé Prometis. Une seule chose à échanger, un seul
   * mécanisme à relire.
   */
  async publierEvenement(
    evenement: string,
    charge: Record<string, unknown>,
  ): Promise<ResultatLivraison> {
    if (!this.configure) {
      return { livre: false, raison: 'Passerelle Kolabimo non configurée (URL ou clé absente).' };
    }
    return this.appeler('POST', '/api/v1/webhooks/prometis', { evenement, donnees: charge });
  }

  /** Échéancier d'une promotion — endpoint à ajouter côté Kolabimo (cf. plan §6.5). */
  async lireEcheancier(promotionId: number): Promise<ResultatLivraison & { corps?: unknown }> {
    return this.appeler('GET', `/api/v1/promotions/${promotionId}/echeancier`);
  }

  /** Lots d'une promotion, parkings et prix total acte compris. */
  async listerLots(promotionId: number): Promise<ResultatLivraison & { corps?: unknown }> {
    return this.appeler('GET', `/api/v1/promotions/${promotionId}/lots`);
  }

  /** Réservations d'une promotion, avec leur client. */
  async listerReservations(promotionId: number): Promise<ResultatLivraison & { corps?: unknown }> {
    return this.appeler('GET', `/api/v1/promotions/${promotionId}/reservations`);
  }

  private async appeler(
    methode: 'GET' | 'POST',
    chemin: string,
    corps?: unknown,
  ): Promise<ResultatLivraison & { corps?: unknown }> {
    if (!this.configure) {
      return { livre: false, raison: 'Passerelle Kolabimo non configurée (URL ou clé absente).' };
    }

    const cle = this.env.KOLABIMO_API_KEY as string;
    const url = `${(this.env.KOLABIMO_API_URL as string).replace(/\/+$/, '')}${chemin}`;
    const corpsBrut = corps === undefined ? '' : JSON.stringify(corps);

    const entetes: Record<string, string> = {
      [ENTETE_CLE_API]: cle,
      // On signe le corps exact qui part sur le fil — pas l'objet, qui
      // pourrait se re-sérialiser autrement et invalider la signature.
      [ENTETE_SIGNATURE]: signer(cle, corpsBrut),
      accept: 'application/json',
    };
    if (corps !== undefined) entetes['content-type'] = 'application/json';

    try {
      const reponse = await fetch(url, {
        method: methode,
        headers: entetes,
        body: corps === undefined ? undefined : corpsBrut,
        signal: AbortSignal.timeout(this.env.KOLABIMO_TIMEOUT_MS),
      });

      const texte = await reponse.text();
      if (!reponse.ok) {
        return {
          livre: false,
          statutHttp: reponse.status,
          raison: `Kolabimo a répondu ${reponse.status} : ${texte.slice(0, 300)}`,
        };
      }

      return {
        livre: true,
        statutHttp: reponse.status,
        corps: texte ? sansLever(texte) : undefined,
      };
    } catch (erreur) {
      const raison = erreur instanceof Error ? erreur.message : 'Appel sortant impossible';
      this.logger.warn(`Kolabimo injoignable (${methode} ${chemin}) : ${raison}`);
      return { livre: false, raison };
    }
  }
}

/** Une réponse non-JSON ne doit pas se transformer en exception de plus. */
function sansLever(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return texte;
  }
}
