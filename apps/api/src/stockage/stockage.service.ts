import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadEnv, type Env } from '../config/env';
import { TAILLE_MAX_OCTETS, cleObjetSure, construireCleObjet } from './chemin';

export interface ObjetDepose {
  cle: string;
  taille: number;
}

/**
 * **Le** point d'accès au stockage de fichiers.
 *
 * Même motif que `MailService` : un seul endroit parle au support physique,
 * pour qu'en changer ne touche qu'un fichier. Deux transports :
 *
 *   · `local` — écrit sous un répertoire du poste. C'est le défaut, il permet
 *     de développer et de tester la GED sans compte object storage. **Refusé
 *     en production** : le disque d'un conteneur n'est pas un stockage durable,
 *     et le laisser passer donnerait une GED qui perd ses pièces au premier
 *     redéploiement.
 *   · `s3` — l'object storage Infomaniak, compatible S3 et hébergé en Suisse.
 *     C'est le transport de production. Il partage exactement la même
 *     convention de clé que `local` : passer de l'un à l'autre ne change ni
 *     les fiches en base, ni le reste de la GED.
 */
@Injectable()
export class StockageService {
  private readonly logger = new Logger(StockageService.name);
  private readonly env: Env = loadEnv();

  /** Construit paresseusement : sans transport S3, aucun client n'est ouvert. */
  private s3?: S3Client;

  get description(): {
    transport: Env['STOCKAGE_TRANSPORT'];
    racine: string | null;
    bucket: string | null;
  } {
    const local = this.env.STOCKAGE_TRANSPORT === 'local';
    return {
      transport: this.env.STOCKAGE_TRANSPORT,
      racine: local ? this.racine() : null,
      bucket: local ? null : (this.env.S3_BUCKET ?? null),
    };
  }

  async deposer(options: {
    societeId: number;
    operationId?: number | null;
    nomFichier: string;
    contenu: Buffer;
  }): Promise<ObjetDepose> {
    if (options.contenu.length === 0) {
      throw new BadRequestException('Fichier vide.');
    }
    if (options.contenu.length > TAILLE_MAX_OCTETS) {
      throw new BadRequestException(
        `Fichier trop volumineux : ${Math.round(options.contenu.length / 1024 / 1024)} Mo ` +
          `pour un maximum de ${TAILLE_MAX_OCTETS / 1024 / 1024} Mo.`,
      );
    }

    const cle = construireCleObjet({
      societeId: options.societeId,
      operationId: options.operationId,
      nomFichier: options.nomFichier,
    });

    if (this.env.STOCKAGE_TRANSPORT === 's3') {
      await this.client().send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: cle,
          Body: options.contenu,
          ContentLength: options.contenu.length,
        }),
      );
    } else {
      const chemin = this.cheminLocal(cle);
      await mkdir(dirname(chemin), { recursive: true });
      await writeFile(chemin, options.contenu);
    }

    this.logger.log(`Document déposé : ${cle} (${options.contenu.length} octets)`);
    return { cle, taille: options.contenu.length };
  }

  async lire(cle: string): Promise<Buffer> {
    try {
      if (this.env.STOCKAGE_TRANSPORT === 's3') {
        const reponse = await this.client().send(
          new GetObjectCommand({ Bucket: this.bucket(), Key: cle }),
        );
        const octets = await reponse.Body?.transformToByteArray();
        if (!octets) throw new Error('Corps vide.');
        return Buffer.from(octets);
      }
      return await readFile(this.cheminLocal(cle));
    } catch {
      // Une pièce absente du support alors que la fiche existe en base est un
      // incident d'exploitation, pas une erreur de l'utilisateur — mais on ne
      // lui répond pas 500 pour autant : le document, pour lui, est introuvable.
      throw new NotFoundException(
        'Le fichier est introuvable sur le support de stockage. La fiche existe, la pièce non.',
      );
    }
  }

  /**
   * Supprime la pièce.
   *
   * Ne lève pas si elle a déjà disparu : la fiche en base est la référence, et
   * un support incohérent ne doit pas empêcher de nettoyer.
   */
  async supprimer(cle: string): Promise<void> {
    try {
      if (this.env.STOCKAGE_TRANSPORT === 's3') {
        await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: cle }));
        return;
      }
      await unlink(this.cheminLocal(cle));
    } catch {
      this.logger.warn(`Suppression sans effet, fichier déjà absent : ${cle}`);
    }
  }

  private racine(): string {
    return resolve(this.env.STOCKAGE_LOCAL_DIR);
  }

  /**
   * Client S3, construit une fois.
   *
   * `forcePathStyle` parce qu'un fournisseur autre qu'AWS sert les buckets
   * par chemin : les sous-domaines par bucket supposeraient un certificat
   * générique dont il ne dispose pas.
   */
  private client(): S3Client {
    if (!this.s3) {
      if (!this.env.S3_ENDPOINT || !this.env.S3_ACCESS_KEY_ID || !this.env.S3_SECRET_ACCESS_KEY) {
        throw new InternalServerErrorException(
          'STOCKAGE_TRANSPORT=s3 mais le point d’accès ou les identifiants manquent. ' +
            'Renseigner S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY.',
        );
      }
      this.s3 = new S3Client({
        endpoint: this.env.S3_ENDPOINT,
        region: this.env.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.env.S3_ACCESS_KEY_ID,
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        },
      });
    }
    return this.s3;
  }

  private bucket(): string {
    if (!this.env.S3_BUCKET) {
      throw new InternalServerErrorException('S3_BUCKET n’est pas renseigné.');
    }
    return this.env.S3_BUCKET;
  }

  private cheminLocal(cle: string): string {
    if (this.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        "Le stockage local est refusé en production : le disque d'un conteneur n'est pas " +
          'durable, et la GED y perdrait ses pièces au premier redéploiement.',
      );
    }
    if (!cleObjetSure(cle)) {
      throw new BadRequestException(`Clé de document invalide : ${cle}`);
    }

    const racine = this.racine();
    const chemin = resolve(join(racine, cle));
    // Ceinture et bretelles : `cleObjetSure` rejette déjà `..`, mais on vérifie
    // le chemin RÉSOLU. C'est la seule vérification qui tienne quel que soit ce
    // qui a pu être écrit en base auparavant.
    if (chemin !== racine && !chemin.startsWith(racine + sep)) {
      throw new BadRequestException('Chemin de document hors du répertoire de stockage.');
    }
    return chemin;
  }
}
