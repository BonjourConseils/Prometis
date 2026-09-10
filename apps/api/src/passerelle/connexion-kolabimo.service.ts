import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { loadEnv, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { chiffrer, dechiffrer } from '../auth/chiffrement';
import { KolabimoClient, type AccesKolabimo } from './kolabimo.client';

export const KOLABIMO_PAR_DEFAUT = 'https://kolabimo.ch';

export interface EtatConnexion {
  connectee: boolean;
  baseUrl: string | null;
  /** « …a3f9 » — de quoi reconnaître la clé sans jamais la renvoyer. */
  cleApercu: string | null;
  promoteur: { id: number; nom: string } | null;
  verifieeLe: Date | null;
  derniereErreur: string | null;
  /** À coller dans Kolabimo, « Ma société → Intégrations & API ». */
  webhook: { url: string } | null;
  chiffrementDisponible: boolean;
}

/**
 * La connexion d'une société à son compte Kolabimo.
 *
 * **Deux secrets, deux sens, jamais confondus.**
 *
 *   · La **clé d'API** vient de Kolabimo : le promoteur la génère dans « Ma
 *     société → Intégrations & API » et la colle ici. Elle sert à LIRE — ses
 *     promotions, leurs lots, l'échéancier, les réservations.
 *   · Le **secret de webhook** vient de Prometis : il est généré ici, montré
 *     une fois, et collé dans Kolabimo à côté de l'URL. Kolabimo s'en sert
 *     pour SIGNER ce qu'il pousse, nous pour le vérifier.
 *
 * Utiliser la clé d'API comme secret de signature — ce que faisait le Lot 7 —
 * aurait fait d'une seule fuite une double compromission : lire ET forger.
 *
 * Les deux doivent se relire en clair, donc sont chiffrés et non hachés ; la
 * clé de chiffrement vit hors de la base. **Aucun des deux ne ressort de
 * l'API**, sauf le secret de webhook, une seule fois, à sa génération — c'est
 * le moment où le promoteur doit le copier.
 */
@Injectable()
export class ConnexionKolabimoService {
  private readonly logger = new Logger(ConnexionKolabimoService.name);
  private readonly env: Env;

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly kolabimo: KolabimoClient,
  ) {
    this.env = loadEnv();
  }

  async etat(societeId: number): Promise<EtatConnexion> {
    const connexion = await this.db.runInTenant(societeId, (tx) =>
      tx.connexionKolabimo.findUnique({ where: { societeId } }),
    );
    return {
      connectee: Boolean(connexion?.cleApiChiffree),
      baseUrl: connexion?.baseUrl ?? null,
      cleApercu: connexion?.cleApiApercu ?? null,
      promoteur:
        connexion?.promoteurKolabimoId && connexion.promoteurKolabimoNom
          ? { id: connexion.promoteurKolabimoId, nom: connexion.promoteurKolabimoNom }
          : null,
      verifieeLe: connexion?.verifieeLe ?? null,
      derniereErreur: connexion?.derniereErreur ?? null,
      webhook: connexion ? { url: this.urlWebhook(connexion.jetonWebhook) } : null,
      chiffrementDisponible: Boolean(this.env.INTEGRATIONS_ENCRYPTION_KEY),
    };
  }

  /**
   * Enregistre la clé — **après** l'avoir essayée.
   *
   * Une clé qu'on n'a pas vue marcher ne vaut pas d'être stockée : l'erreur
   * apparaîtrait trois écrans plus loin, sur la première promotion qu'on
   * tente de lire, loin de la saisie qui l'a causée.
   *
   * Et elle doit être une clé de **promoteur**. Une clé d'agence est valide,
   * mais son périmètre est celui des promotions où l'agence est mandatée — elle
   * ne verrait pas l'échéancier, et pousserait Prometis à gérer l'argent d'une
   * promotion qui n'est pas celle du promoteur.
   */
  async enregistrer(
    societeId: number,
    donnees: { baseUrl?: string; cleApi: string },
  ): Promise<{ etat: EtatConnexion; secretWebhook: string | null }> {
    const cleChiffrement = this.exigerChiffrement();
    const baseUrl = normaliserBaseUrl(donnees.baseUrl);
    const cle = donnees.cleApi.trim();

    const moi = await this.kolabimo.moi({ baseUrl, cle });
    if (!moi.ok) throw new BadRequestException(moi.raison);
    if (moi.donnees.type !== 'PROMOTEUR') {
      throw new BadRequestException(
        `Cette clé appartient à « ${moi.donnees.nom} », une ${moi.donnees.type.toLowerCase()} — ` +
          `pas à un promoteur. Générez la clé depuis le compte promoteur, dans Kolabimo : ` +
          `Ma société → Intégrations & API.`,
      );
    }

    let secretNeuf: string | null = null;
    await this.db.runInTenant(societeId, async (tx) => {
      const existante = await tx.connexionKolabimo.findUnique({ where: { societeId } });

      const commun = {
        baseUrl,
        cleApiChiffree: chiffrer(cle, cleChiffrement),
        cleApiApercu: `…${cle.slice(-4)}`,
        promoteurKolabimoId: moi.donnees.id,
        promoteurKolabimoNom: moi.donnees.nom,
        verifieeLe: new Date(),
        derniereErreur: null,
      };

      if (existante) {
        await tx.connexionKolabimo.update({ where: { societeId }, data: commun });
      } else {
        // Le secret de webhook naît avec la connexion. Il n'est rendu qu'ici :
        // perdu, il se régénère — il ne se relit pas.
        secretNeuf = genererSecret();
        await tx.connexionKolabimo.create({
          data: {
            societeId,
            ...commun,
            jetonWebhook: genererJeton(),
            secretWebhookChiffre: chiffrer(secretNeuf, cleChiffrement),
          },
        });
      }

      await this.audit.enregistrer(tx, {
        action: existante ? 'kolabimo.cle_remplacee' : 'kolabimo.connexion_creee',
        entite: 'ConnexionKolabimo',
        // Jamais la clé, même tronquée au-delà de l'aperçu affiché à l'écran.
        donnees: { baseUrl, promoteurKolabimo: moi.donnees.nom, cleApercu: commun.cleApiApercu },
      });
    });

    return { etat: await this.etat(societeId), secretWebhook: secretNeuf };
  }

  /** Réessaie la clé enregistrée, et garde la trace du résultat. */
  async tester(societeId: number): Promise<EtatConnexion> {
    const acces = await this.acces(societeId);
    const moi = await this.kolabimo.moi(acces);
    await this.db.runInTenant(societeId, (tx) =>
      tx.connexionKolabimo.update({
        where: { societeId },
        data: moi.ok
          ? {
              verifieeLe: new Date(),
              derniereErreur: null,
              promoteurKolabimoId: moi.donnees.id,
              promoteurKolabimoNom: moi.donnees.nom,
            }
          : { derniereErreur: moi.raison },
      }),
    );
    return this.etat(societeId);
  }

  /**
   * Un nouveau secret de webhook — l'ancien cesse aussitôt de valoir.
   *
   * Les webhooks signés avec l'ancien seront refusés jusqu'à ce que le
   * nouveau soit collé dans Kolabimo. C'est le prix d'une rotation, et
   * l'écran le dit au moment du clic.
   */
  async regenererSecret(societeId: number): Promise<{ secretWebhook: string }> {
    const cleChiffrement = this.exigerChiffrement();
    const secret = genererSecret();
    await this.db.runInTenant(societeId, async (tx) => {
      const existante = await tx.connexionKolabimo.findUnique({ where: { societeId } });
      if (!existante) throw new NotFoundException('Aucune connexion Kolabimo à renouveler.');
      await tx.connexionKolabimo.update({
        where: { societeId },
        data: { secretWebhookChiffre: chiffrer(secret, cleChiffrement) },
      });
      await this.audit.enregistrer(tx, {
        action: 'kolabimo.secret_webhook_regenere',
        entite: 'ConnexionKolabimo',
        entiteId: existante.id,
      });
    });
    return { secretWebhook: secret };
  }

  async supprimer(societeId: number): Promise<void> {
    await this.db.runInTenant(societeId, async (tx) => {
      const existante = await tx.connexionKolabimo.findUnique({ where: { societeId } });
      if (!existante) return;
      await tx.connexionKolabimo.delete({ where: { societeId } });
      await this.audit.enregistrer(tx, {
        action: 'kolabimo.connexion_supprimee',
        entite: 'ConnexionKolabimo',
        entiteId: existante.id,
        donnees: { promoteurKolabimo: existante.promoteurKolabimoNom },
      });
    });
  }

  /** L'accès à l'API au nom de cette société — ou une erreur qui dit quoi faire. */
  async acces(societeId: number): Promise<AccesKolabimo> {
    const connexion = await this.db.runInTenant(societeId, (tx) =>
      tx.connexionKolabimo.findUnique({ where: { societeId } }),
    );
    if (!connexion?.cleApiChiffree) {
      throw new BadRequestException(
        "Kolabimo n'est pas connecté. Saisissez votre clé d'API promoteur dans l'écran Passerelle.",
      );
    }
    return {
      baseUrl: connexion.baseUrl,
      cle: dechiffrer(connexion.cleApiChiffree, this.exigerChiffrement()),
    };
  }

  /**
   * Retrouve la société d'un webhook par le jeton de son URL, et son secret.
   *
   * Aucune session ici : c'est Kolabimo qui appelle. D'où la fonction
   * `SECURITY DEFINER` — la table est sous RLS, et le tenant est justement ce
   * qu'on cherche. Elle rend le secret **chiffré** ; le déchiffrer exige encore
   * la clé hors base.
   */
  async resoudreJeton(jeton: string): Promise<{ societeId: number; secret: string } | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(jeton)) return null;
    const lignes = await this.prisma.$queryRaw<
      { societe_id: number; secret_webhook_chiffre: string }[]
    >`SELECT societe_id, secret_webhook_chiffre FROM app.societe_de_jeton_kolabimo(${jeton})`;
    const ligne = lignes[0];
    if (!ligne) return null;
    try {
      return {
        societeId: ligne.societe_id,
        secret: dechiffrer(ligne.secret_webhook_chiffre, this.exigerChiffrement()),
      };
    } catch (erreur) {
      this.logger.error(
        `Secret de webhook indéchiffrable pour la société ${ligne.societe_id} : ${String(erreur)}`,
      );
      return null;
    }
  }

  urlWebhook(jeton: string): string {
    return `${this.env.PUBLIC_API_URL.replace(/\/+$/, '')}/webhooks/kolabimo/${jeton}`;
  }

  private exigerChiffrement(): string {
    const cle = this.env.INTEGRATIONS_ENCRYPTION_KEY;
    if (!cle) {
      throw new BadRequestException(
        "INTEGRATIONS_ENCRYPTION_KEY n'est pas configurée sur le serveur. La clé Kolabimo est " +
          'refusée plutôt que stockée en clair : lisible en base, elle ouvrirait vos promotions ' +
          'à quiconque obtient une copie de la base.',
      );
    }
    return cle;
  }
}

/**
 * L'adresse de Kolabimo, sans chemin : la clé se colle souvent avec l'URL de
 * la page où on l'a trouvée. Seul HTTPS est accepté, sauf en local — une clé
 * d'API ne voyage pas en clair.
 */
export function normaliserBaseUrl(saisie: string | undefined): string {
  const brut = (saisie ?? '').trim() || KOLABIMO_PAR_DEFAUT;
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    throw new BadRequestException(`Adresse Kolabimo invalide : « ${brut} ».`);
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new BadRequestException(
      "L'adresse de Kolabimo doit être en https : la clé d'API voyage dans chaque requête.",
    );
  }
  return url.origin;
}

function genererJeton(): string {
  return randomBytes(24).toString('base64url');
}

function genererSecret(): string {
  return randomBytes(32).toString('base64url');
}
