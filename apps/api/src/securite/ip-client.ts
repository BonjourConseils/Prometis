import { timingSafeEqual } from 'node:crypto';

/** En-têtes posés par le relais Next, et seulement par lui. */
export const ENTETE_RELAIS = 'x-prometis-relais';
export const ENTETE_IP_CLIENT = 'x-prometis-client-ip';

/**
 * L'adresse du vrai client — pas celle du relais.
 *
 * Le navigateur ne parle jamais à l'API : tout passe par le relais Next, qui
 * rattache le jeton de session. Vue de l'API, **chaque utilisateur a donc
 * l'adresse du serveur Next**. Une limite de tentatives par adresse aurait
 * bloqué tout le monde au premier attaquant, et un journal d'audit aurait
 * inscrit partout la même IP.
 *
 * Le relais transmet donc l'adresse qu'il a vue. Mais l'API est aussi joignable
 * directement (webhooks Kolabimo) : un en-tête d'IP, n'importe qui peut
 * l'écrire. On ne le croit que s'il vient avec le **secret partagé** du relais,
 * comparé à temps constant. Sans secret configuré — le poste de développement —
 * on ne croit personne, et c'est l'adresse de la connexion qui compte.
 */
export function ipClient(options: {
  ipConnexion: string | undefined;
  entetes: Record<string, string | string[] | undefined>;
  secretRelais: string | undefined;
}): string {
  const connexion = normaliser(options.ipConnexion) ?? 'inconnue';
  const secret = options.secretRelais;
  if (!secret) return connexion;

  const presente = premiere(options.entetes[ENTETE_RELAIS]);
  if (!presente || !egal(presente, secret)) return connexion;

  return normaliser(premiere(options.entetes[ENTETE_IP_CLIENT])) ?? connexion;
}

function premiere(valeur: string | string[] | undefined): string | undefined {
  return Array.isArray(valeur) ? valeur[0] : valeur;
}

/** `::ffff:127.0.0.1` → `127.0.0.1` ; une liste `a, b` → `a` ; et rien d'exotique. */
function normaliser(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const premiereAdresse = ip
    .split(',')[0]!
    .trim()
    .replace(/^::ffff:/, '');
  // Une adresse, pas un texte libre : cette valeur finit dans le journal.
  return /^[0-9a-fA-F.:]{2,45}$/.test(premiereAdresse) ? premiereAdresse : undefined;
}

function egal(a: string, b: string): boolean {
  const ta = Buffer.from(a);
  const tb = Buffer.from(b);
  return ta.length === tb.length && timingSafeEqual(ta, tb);
}
