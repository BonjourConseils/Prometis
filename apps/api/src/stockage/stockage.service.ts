import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
 *   · `s3` — non implémenté, et c'est délibéré. Le choix du fournisseur
 *     (Exoscale, Infomaniak) engage l'hébergement des données en Suisse au
 *     sens de la nLPD ; il ne se prend pas en passant. Le transport lève un
 *     message qui le dit, plutôt que d'écrire ailleurs en silence.
 */
@Injectable()
export class StockageService {
  private readonly logger = new Logger(StockageService.name);
  private readonly env: Env = loadEnv();

  get description(): { transport: Env['STOCKAGE_TRANSPORT']; racine: string | null } {
    return {
      transport: this.env.STOCKAGE_TRANSPORT,
      racine: this.env.STOCKAGE_TRANSPORT === 'local' ? this.racine() : null,
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

    const chemin = this.cheminLocal(cle);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, options.contenu);
    this.logger.log(`Document déposé : ${cle} (${options.contenu.length} octets)`);

    return { cle, taille: options.contenu.length };
  }

  async lire(cle: string): Promise<Buffer> {
    const chemin = this.cheminLocal(cle);
    try {
      return await readFile(chemin);
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
      await unlink(this.cheminLocal(cle));
    } catch {
      this.logger.warn(`Suppression sans effet, fichier déjà absent : ${cle}`);
    }
  }

  private racine(): string {
    return resolve(this.env.STOCKAGE_LOCAL_DIR);
  }

  private cheminLocal(cle: string): string {
    if (this.env.STOCKAGE_TRANSPORT !== 'local') {
      throw new InternalServerErrorException(
        `STOCKAGE_TRANSPORT=${this.env.STOCKAGE_TRANSPORT} n'est pas implémenté. ` +
          "Le choix d'un object storage suisse (nLPD) reste à arbitrer — cf. la liste des " +
          'sujets en attente dans la roadmap.',
      );
    }
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
