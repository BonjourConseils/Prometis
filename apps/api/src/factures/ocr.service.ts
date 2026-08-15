import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { loadEnv, type Env } from '../config/env';

const executer = promisify(execFile);

/**
 * Extraction du texte d'un PDF de facture — **auto-hébergée**.
 *
 * C'est le seul point du produit où des données de tiers auraient pu partir
 * chez un prestataire : une facture porte le nom d'un fournisseur, ses
 * montants, parfois ses coordonnées bancaires. Déléguer cette étape à un
 * service en ligne aurait posé une question nLPD à chaque facture. En
 * exécutant un binaire local, la question ne se pose plus : **rien ne sort
 * du serveur**.
 *
 * Deux transports :
 *   · `absent` — défaut. L'analyse continue de fonctionner sur un texte
 *     fourni à la main, comme depuis le Lot 5. Rien ne casse.
 *   · `local` — appelle le binaire configuré. `pdftotext` (poppler) suffit
 *     aux PDF déjà textuels, c'est-à-dire l'immense majorité des factures
 *     d'entreprise ; pour des scans, pointer `OCR_COMMANDE` sur `ocrmypdf`
 *     ou `tesseract`.
 *
 * La commande est lancée par `execFile`, **jamais** via un shell : le nom du
 * fichier ne peut donc pas être interprété comme une commande.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly env: Env = loadEnv();

  get disponible(): boolean {
    return this.env.OCR_TRANSPORT === 'local';
  }

  get description(): { transport: Env['OCR_TRANSPORT']; commande: string | null } {
    return {
      transport: this.env.OCR_TRANSPORT,
      commande: this.disponible ? this.env.OCR_COMMANDE : null,
    };
  }

  /**
   * Renvoie le texte d'un PDF.
   *
   * Le fichier transite par un répertoire temporaire, effacé quoi qu'il
   * arrive : une facture laissée sur le disque du serveur, c'est une donnée
   * de tiers hors de la GED et hors de toute politique de conservation.
   */
  async extraire(pdf: Buffer): Promise<string> {
    if (!this.disponible) {
      throw new BadRequestException(
        "L'extraction automatique n'est pas activée sur ce serveur (OCR_TRANSPORT=absent). " +
          'Fournir le texte de la facture, ou activer le binaire local.',
      );
    }

    const dossier = await mkdtemp(join(tmpdir(), 'prometis-ocr-'));
    const chemin = join(dossier, 'facture.pdf');

    try {
      await writeFile(chemin, pdf);
      const arguments_ = this.env.OCR_ARGUMENTS.split(',').map((a) =>
        a.trim().replace('{fichier}', chemin),
      );

      const { stdout } = await executer(this.env.OCR_COMMANDE, arguments_, {
        timeout: this.env.OCR_TIMEOUT_MS,
        // Une facture de plusieurs pages produit vite quelques centaines de
        // kilo-octets ; la limite par défaut de Node les tronquerait.
        maxBuffer: 16 * 1024 * 1024,
      });

      const texte = stdout.trim();
      if (!texte) {
        throw new BadRequestException(
          'Le PDF ne contient aucun texte exploitable. S’il s’agit d’un scan, configurer ' +
            'un binaire capable de reconnaissance de caractères (ocrmypdf, tesseract).',
        );
      }
      this.logger.log(`Texte extrait : ${texte.length} caractères.`);
      return texte;
    } catch (erreur) {
      if (erreur instanceof BadRequestException) throw erreur;
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      this.logger.error(`Extraction impossible : ${message}`);
      throw new BadRequestException(
        `Extraction impossible avec « ${this.env.OCR_COMMANDE} » : ${message}`,
      );
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }
}
