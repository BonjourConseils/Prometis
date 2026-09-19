import { randomBytes } from 'node:crypto';

/**
 * La réception des factures par e-mail — les règles, pures et testées.
 *
 * Une adresse par promotion, sur un sous-domaine dédié :
 * `jardins-de-prilly-k3q9x7m2p4tz@factures.<domaine>`. Le jeton aléatoire
 * rend l'adresse impossible à deviner ; le nom n'est là que pour que les
 * gens s'y retrouvent.
 *
 * C'est une porte non authentifiée : qui connaît l'adresse y dépose ce qu'il
 * veut. Par défaut, seuls passent les expéditeurs connus de la société — et
 * seulement si l'authentification du message n'a pas échoué. Le reste va en
 * quarantaine, sans être perdu (skill `capture-documents`, § 9).
 */

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** 12 caractères sur 32 symboles : 60 bits — l'adresse ne se devine pas. */
export function genererJetonBoite(): string {
  const octets = randomBytes(12);
  return Array.from(octets, (o) => ALPHABET[o % ALPHABET.length]).join('');
}

/** « Les Jardins de Prilly » → « les-jardins-de-prilly », 30 caractères au plus. */
export function slug(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/g, '') || 'promotion'
  );
}

export function adresseBoite(nomOperation: string, jeton: string, domaine: string): string {
  return `${slug(nomOperation)}-${jeton}@${domaine}`;
}

/**
 * Le jeton, retrouvé parmi les destinataires du message (To, Cc,
 * Delivered-To, X-Original-To). Seul compte ce qui suit le dernier tiret : le
 * nom peut changer, l'adresse reste valable.
 */
export function jetonDepuisAdresses(adresses: string[], domaine: string): string | null {
  const suffixe = `@${domaine.toLowerCase()}`;
  for (const brute of adresses) {
    const a = brute.trim().toLowerCase().replace(/^.*</, '').replace(/>.*$/, '');
    if (!a.endsWith(suffixe)) continue;
    const local = a.slice(0, -suffixe.length).split('+')[0]!;
    const jeton = local.split('-').at(-1) ?? '';
    if (/^[a-z2-9]{12}$/.test(jeton)) return jeton;
  }
  return null;
}

export function normaliserEmail(e: string): string {
  return e.trim().toLowerCase();
}

export type Authentification = 'ok' | 'echec' | 'inconnue';

/**
 * Le verdict d'authentification, lu dans l'en-tête `Authentication-Results`
 * ajouté par NOTRE serveur de réception — le premier du message. DMARC prime ;
 * à défaut, un SPF ou un DKIM valide suffit ; un échec des deux est un échec.
 */
export function verdictAuthentification(entete: string | null | undefined): Authentification {
  if (!entete) return 'inconnue';
  const h = entete.toLowerCase();
  if (/\bdmarc=fail\b/.test(h)) return 'echec';
  if (/\bdmarc=pass\b/.test(h)) return 'ok';
  const spf = /\bspf=pass\b/.test(h);
  const dkim = /\bdkim=pass\b/.test(h);
  if (spf || dkim) return 'ok';
  if (/\bspf=(fail|softfail)\b/.test(h) || /\bdkim=fail\b/.test(h)) return 'echec';
  return 'inconnue';
}

export interface Decision {
  statut: 'ACCEPTE' | 'QUARANTAINE';
  motif: string | null;
}

export function decider(p: {
  expediteur: string;
  connus: ReadonlySet<string>;
  ouverte: boolean;
  authentification: Authentification;
}): Decision {
  if (p.authentification === 'echec') {
    return {
      statut: 'QUARANTAINE',
      motif:
        'L’authentification de l’expéditeur a échoué : l’adresse d’envoi est peut-être usurpée.',
    };
  }
  if (!p.ouverte && !p.connus.has(normaliserEmail(p.expediteur))) {
    return {
      statut: 'QUARANTAINE',
      motif: 'Expéditeur inconnu de la société : à libérer à la main s’il est légitime.',
    };
  }
  return { statut: 'ACCEPTE', motif: null };
}

/** Pièces jointes retenues : 10 au plus ; les images incorporées (logos) sont ignorées. */
export const PIECES_MAX = 10;
export const MESSAGE_MAX_OCTETS = 30 * 1024 * 1024;
