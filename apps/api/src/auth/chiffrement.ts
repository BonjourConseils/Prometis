import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Chiffrement au repos des secrets qui doivent rester lisibles.
 *
 * Un mot de passe se **hache** : on n'a jamais besoin de le relire. Un secret
 * TOTP, si — il faut le recalculer à chaque code présenté. Il ne peut donc pas
 * être haché, et le laisser en clair mettrait quiconque lit la table `comptes`
 * en position de fabriquer les codes de n'importe qui.
 *
 * D'où AES-256-GCM, avec une clé qui vit **hors de la base** : une copie du
 * dump ne suffit plus, il faut aussi la variable d'environnement.
 *
 * Format stocké : `v1.<nonce>.<étiquette>.<chiffré>`, tout en base64url. Le
 * préfixe de version permettra de tourner l'algorithme sans deviner ce qu'on
 * relit.
 */

const VERSION = 'v1';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_NONCE = 12;

export class ChiffrementNonConfigure extends Error {
  constructor() {
    super(
      "MFA_ENCRYPTION_KEY n'est pas configurée. Le second facteur est refusé plutôt que " +
        "stocké en clair : un secret TOTP lisible en base vaut l'absence de second facteur.",
    );
  }
}

/**
 * Dérive la clé de chiffrement depuis la variable d'environnement.
 *
 * SHA-256 sur la valeur brute : la clé d'environnement n'est pas un mot de
 * passe humain, elle est déjà censée être aléatoire. Le passage par SHA-256
 * ne sert qu'à ramener n'importe quelle longueur aux 32 octets d'AES-256.
 */
function cle(secretEnv: string | undefined): Buffer {
  if (!secretEnv || secretEnv.length < 32) throw new ChiffrementNonConfigure();
  return createHash('sha256').update(secretEnv, 'utf8').digest();
}

export function chiffrer(clair: string, secretEnv: string | undefined): string {
  const nonce = randomBytes(TAILLE_NONCE);
  const chiffreur = createCipheriv(ALGORITHME, cle(secretEnv), nonce);
  const chiffre = Buffer.concat([chiffreur.update(clair, 'utf8'), chiffreur.final()]);
  const etiquette = chiffreur.getAuthTag();

  return [
    VERSION,
    nonce.toString('base64url'),
    etiquette.toString('base64url'),
    chiffre.toString('base64url'),
  ].join('.');
}

export function dechiffrer(stocke: string, secretEnv: string | undefined): string {
  const [version, nonce, etiquette, chiffre] = stocke.split('.');
  if (version !== VERSION || !nonce || !etiquette || !chiffre) {
    throw new Error('Secret chiffré illisible : format inattendu.');
  }

  const dechiffreur = createDecipheriv(ALGORITHME, cle(secretEnv), Buffer.from(nonce, 'base64url'));
  // GCM authentifie : une valeur modifiée en base fait échouer `final()`
  // plutôt que de rendre un secret silencieusement faux.
  dechiffreur.setAuthTag(Buffer.from(etiquette, 'base64url'));

  return Buffer.concat([
    dechiffreur.update(Buffer.from(chiffre, 'base64url')),
    dechiffreur.final(),
  ]).toString('utf8');
}

/**
 * Empreinte d'un code de secours.
 *
 * SHA-256 sans sel, et c'est délibéré : ces codes sont **générés par la
 * machine** avec ~50 bits d'entropie, pas choisis par un humain. Le coût d'un
 * hachage lent (argon2) protège des mots de passe devinables ; ici il ne
 * protégerait de rien et ralentirait chaque connexion de secours d'autant de
 * fois qu'il reste de codes.
 */
export function empreinteCodeSecours(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('base64url');
}
