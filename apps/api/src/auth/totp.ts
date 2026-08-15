import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP — mots de passe à usage unique fondés sur le temps (RFC 6238).
 *
 * Écrit ici plutôt qu'ajouté en dépendance : l'algorithme tient en cinquante
 * lignes, il est figé depuis 2011, et les vecteurs de test de la RFC en
 * donnent la vérité au chiffre près. Une bibliothèque de plus, c'est une
 * surface d'approvisionnement de plus sur le chemin de l'authentification.
 *
 * Tout est pur : aucune base, aucune horloge implicite — l'instant est un
 * paramètre. C'est ce qui rend les vecteurs de la RFC rejouables.
 */

const ALPHABET_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Pas de temps, en secondes. 30 s est la valeur que tous les authentificateurs supposent. */
export const PAS_SECONDES = 30;

/**
 * Tolérance, en nombre de pas de part et d'autre.
 *
 * Un pas absorbe une horloge de téléphone légèrement décalée et le temps de
 * frappe du code. Élargir la fenêtre multiplie d'autant les codes valides à
 * un instant donné : on ne le fait pas sans raison.
 */
export const FENETRE_PAS = 1;

// =====================================================================
//  Base32 (RFC 4648, sans remplissage) — le format qu'attendent les
//  applications d'authentification.
// =====================================================================

export function encoderBase32(donnees: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = '';

  for (const octet of donnees) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET_BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET_BASE32[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function decoderBase32(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];

  for (const caractere of propre) {
    const index = ALPHABET_BASE32.indexOf(caractere);
    if (index === -1) throw new Error(`Caractère base32 invalide : « ${caractere} ».`);
    valeur = (valeur << 5) | index;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

// =====================================================================
//  HOTP / TOTP
// =====================================================================

/**
 * Secret partagé, en base32.
 *
 * 20 octets — la taille du bloc de sortie de SHA-1, et ce que la RFC 4226
 * recommande comme minimum.
 */
export function genererSecret(octets = 20): string {
  return encoderBase32(randomBytes(octets));
}

/** HOTP (RFC 4226) : le code d'un compteur donné. */
export function codeHotp(secret: string, compteur: number, chiffres = 6): string {
  const cle = decoderBase32(secret);

  const tampon = Buffer.alloc(8);
  // Compteur sur 64 bits en gros-boutiste. `writeBigUInt64BE` évite le
  // décalage sur 32 bits, qui perdrait les bits hauts au-delà de 2038.
  tampon.writeBigUInt64BE(BigInt(compteur));

  const empreinte = createHmac('sha1', cle).update(tampon).digest();

  // Troncature dynamique : les 4 bits de poids faible du dernier octet
  // désignent où lire les 31 bits significatifs.
  const decalage = empreinte[empreinte.length - 1]! & 0x0f;
  const binaire =
    ((empreinte[decalage]! & 0x7f) << 24) |
    ((empreinte[decalage + 1]! & 0xff) << 16) |
    ((empreinte[decalage + 2]! & 0xff) << 8) |
    (empreinte[decalage + 3]! & 0xff);

  return String(binaire % 10 ** chiffres).padStart(chiffres, '0');
}

/** TOTP (RFC 6238) : le code valable à un instant donné. */
export function codeTotp(
  secret: string,
  instant: Date = new Date(),
  options: { pas?: number; chiffres?: number } = {},
): string {
  const pas = options.pas ?? PAS_SECONDES;
  return codeHotp(secret, Math.floor(instant.getTime() / 1000 / pas), options.chiffres ?? 6);
}

/**
 * Vérifie un code, en acceptant la dérive d'horloge.
 *
 * La comparaison est à temps constant : une comparaison naïve fuit, chiffre
 * par chiffre, de quoi reconstituer un code valide par essais successifs.
 */
export function verifierCode(
  secret: string,
  code: string,
  instant: Date = new Date(),
  options: { pas?: number; chiffres?: number; fenetre?: number } = {},
): boolean {
  const chiffres = options.chiffres ?? 6;
  const pas = options.pas ?? PAS_SECONDES;
  const fenetre = options.fenetre ?? FENETRE_PAS;

  const saisi = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${chiffres}}$`).test(saisi)) return false;

  const compteur = Math.floor(instant.getTime() / 1000 / pas);
  let valide = false;
  for (let decalage = -fenetre; decalage <= fenetre; decalage++) {
    // Pas de sortie anticipée : on compare toute la fenêtre pour que la durée
    // ne dise pas quel pas a correspondu.
    if (egalesEnTempsConstant(saisi, codeHotp(secret, compteur + decalage, chiffres))) {
      valide = true;
    }
  }
  return valide;
}

/**
 * URI `otpauth://` à afficher en QR code.
 *
 * L'émetteur apparaît deux fois — dans le libellé et en paramètre — parce que
 * les applications d'authentification ne lisent pas toutes le même.
 */
export function uriOtpauth(secret: string, options: { compte: string; emetteur: string }): string {
  const libelle = encodeURIComponent(`${options.emetteur}:${options.compte}`);
  const parametres = new URLSearchParams({
    secret,
    issuer: options.emetteur,
    algorithm: 'SHA1',
    digits: '6',
    period: String(PAS_SECONDES),
  });
  return `otpauth://totp/${libelle}?${parametres.toString()}`;
}

// =====================================================================
//  Codes de secours
// =====================================================================

/**
 * Codes de secours : la seule porte quand le téléphone est perdu.
 *
 * Chacun porte ~50 bits d'entropie et ne sert qu'une fois. Ils sont affichés
 * **une seule fois**, à l'activation : ce qui est stocké est leur empreinte.
 */
export function genererCodesSecours(combien = 10): string[] {
  return Array.from({ length: combien }, () => {
    const brut = randomBytes(5);
    const texte = encoderBase32(brut).slice(0, 8).toLowerCase();
    return `${texte.slice(0, 4)}-${texte.slice(4)}`;
  });
}

/** Forme comparable d'un code de secours, tirets et casse mis de côté. */
export function normaliserCodeSecours(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function egalesEnTempsConstant(a: string, b: string): boolean {
  const tamponA = Buffer.from(a, 'utf8');
  const tamponB = Buffer.from(b, 'utf8');
  if (tamponA.length !== tamponB.length) return false;
  return timingSafeEqual(tamponA, tamponB);
}
