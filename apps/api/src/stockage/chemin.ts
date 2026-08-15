import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

/**
 * Construction et assainissement des clés d'objet de la GED.
 *
 * Pur, donc testable sans écrire un octet — et c'est là que se joue la
 * sécurité : un nom de fichier vient d'un utilisateur, il peut contenir
 * `../..`, un séparateur de chemin, ou un octet nul.
 */

/** Taille maximale d'un document, en octets. */
export const TAILLE_MAX_OCTETS = 25 * 1024 * 1024;

/**
 * Réduit un nom de fichier à ce qui est sûr à écrire sur un disque.
 *
 * On garde l'extension — elle porte le type et sert au téléchargement — mais
 * le corps du nom est ramené à des caractères sans ambiguïté. Le nom d'origine
 * reste en base (`Document.fileName`) : c'est lui qu'on réaffiche.
 */
export function assainirNomFichier(nom: string): string {
  const extension = extname(nom).toLowerCase().slice(0, 12);
  const base = nom
    .slice(0, nom.length - extname(nom).length)
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    // Tout ce qui n'est pas alphanumérique devient un tiret : séparateurs de
    // chemin, points, caractères de contrôle et espaces partent d'un coup.
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase();

  const extensionSure = /^\.[a-z0-9]{1,11}$/.test(extension) ? extension : '';
  return `${base || 'document'}${extensionSure}`;
}

/**
 * Clé d'objet d'un document.
 *
 * Le tenant est en tête : un préfixe par société rend l'isolation lisible
 * dans le bucket, et permet plus tard une politique d'accès par préfixe. Le
 * segment aléatoire empêche deux dépôts du même nom de s'écraser — et
 * empêche aussi de deviner l'adresse d'un document qu'on n'a pas le droit de
 * lire.
 */
export function construireCleObjet(options: {
  societeId: number;
  operationId?: number | null;
  nomFichier: string;
  annee?: number;
}): string {
  const annee = options.annee ?? new Date().getUTCFullYear();
  const contexte = options.operationId ? `operations/${options.operationId}` : 'hors-operation';
  return [
    `societes/${options.societeId}`,
    contexte,
    String(annee),
    `${randomUUID()}-${assainirNomFichier(options.nomFichier)}`,
  ].join('/');
}

/**
 * Une clé d'objet est-elle sûre à concaténer à une racine locale ?
 *
 * Rien de ce que produit `construireCleObjet` ne peut échouer ici. Le contrôle
 * porte sur ce qui vient de la **base** : une clé enregistrée avant un
 * correctif, ou modifiée par ailleurs, ne doit pas pouvoir faire sortir la
 * lecture du répertoire racine.
 */
export function cleObjetSure(cle: string): boolean {
  if (!cle || cle.length > 400) return false;
  if (cle.startsWith('/') || cle.includes('\\')) return false;
  if (cle.includes('\0')) return false;
  return cle.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
