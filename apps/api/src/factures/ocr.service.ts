import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { loadEnv, type Env } from '../config/env';

const executer = promisify(execFile);

/** En deçà, la couche texte est celle d'un scan : on passe par l'OCR. */
export const CARACTERES_PAR_PAGE = 120;
export const PAGES_OCR_MAX = 8;
const IMAGES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/tiff', '.tif'],
]);

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
        "La lecture automatique n'est pas activée sur ce serveur. Saisissez les montants à la main.",
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
          'Le PDF ne contient aucun texte exploitable — un scan, sans doute. Saisissez les montants à la main.',
        );
      }
      this.logger.log(`Texte extrait : ${texte.length} caractères.`);
      return texte;
    } catch (erreur) {
      if (erreur instanceof BadRequestException) throw erreur;
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      this.logger.error(`Extraction impossible : ${message}`);
      // Le détail (commande, chemin) reste au journal : il ne sert à rien à
      // l'utilisateur, et renseignerait sur le serveur.
      throw new BadRequestException('Le texte de ce PDF n’a pas pu être extrait.');
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }

  // ===================================================================
  //  Texte d'une pièce quelconque : PDF textuel, PDF scanné, photo
  // ===================================================================

  /**
   * Le texte d'une facture, d'où qu'elle vienne.
   *
   * D'abord la couche texte du PDF — exacte et gratuite ; l'OCR seulement si
   * elle manque : moins de 120 caractères par page, et le PDF est traité comme
   * scanné (seuil éprouvé dans Fristo). Huit pages au plus, à 200 dpi. Une
   * photo passe directement par l'OCR. Tout reste sur le serveur.
   */
  async texte(octets: Buffer, mime: string): Promise<{ texte: string; methode: string }> {
    if (!this.disponible) {
      throw new BadRequestException(
        "La lecture automatique n'est pas activée sur ce serveur. Saisissez les montants à la main.",
      );
    }
    const dossier = await mkdtemp(join(tmpdir(), 'prometis-lecture-'));
    try {
      if (mime === 'application/pdf') {
        const pdf = join(dossier, 'piece.pdf');
        await writeFile(pdf, octets);
        const couche = await this.coucheTexte(pdf);
        const pages = Math.max(1, couche.split('\f').length - (couche.endsWith('\f') ? 1 : 0));
        const densite = couche.replace(/\s+/g, '').length / pages;
        if (densite >= CARACTERES_PAR_PAGE) return { texte: couche.trim(), methode: 'texte-pdf' };

        await executer(
          'pdftoppm',
          ['-r', '200', '-png', '-f', '1', '-l', String(PAGES_OCR_MAX), pdf, join(dossier, 'page')],
          {
            timeout: this.env.OCR_TIMEOUT_MS,
          },
        );
        const images = (await readdir(dossier))
          .filter((f) => f.startsWith('page') && f.endsWith('.png'))
          .sort();
        const lus: string[] = [];
        for (const image of images) lus.push(await this.ocr(join(dossier, image)));
        const ocr = lus.join('\n\f\n').trim();
        return couche.trim()
          ? { texte: `${couche.trim()}\n\n${ocr}`, methode: 'texte-pdf+ocr' }
          : { texte: ocr, methode: 'ocr' };
      }
      if (IMAGES.has(mime)) {
        const image = join(dossier, `piece${IMAGES.get(mime)}`);
        await writeFile(image, octets);
        return { texte: (await this.ocr(image)).trim(), methode: 'ocr' };
      }
      throw new BadRequestException('Une facture se lit en PDF ou en image (JPEG, PNG, TIFF).');
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  }

  private async coucheTexte(pdf: string): Promise<string> {
    const { stdout } = await executer('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], {
      timeout: this.env.OCR_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  private async ocr(image: string): Promise<string> {
    try {
      const { stdout } = await executer(
        this.env.OCR_TESSERACT,
        [image, '-', '-l', this.env.OCR_LANGUES, '--psm', '6'],
        { timeout: this.env.OCR_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      );
      return stdout;
    } catch (erreur) {
      const code = (erreur as NodeJS.ErrnoException).code;
      this.logger.error(`Reconnaissance de caractères impossible : ${String(erreur)}`);
      throw new BadRequestException(
        code === 'ENOENT'
          ? 'La lecture des scans et des photos n’est pas disponible sur ce serveur : déposez un PDF textuel, ou saisissez les montants.'
          : 'La reconnaissance de caractères a échoué sur cette pièce.',
      );
    }
  }
}
