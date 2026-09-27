/**
 * Lire le site d'une entreprise pour préremplir sa fiche — module pur.
 *
 * Une URL saisie par un utilisateur est une **entrée non fiable** : le serveur
 * va la chercher lui-même, et il se trouve dans le réseau privé, devant la
 * base et les services internes. `http://localhost:5432`, `http://169.254.169.254`
 * ou un nom qui résout vers 10.x sont donc refusés avant tout appel.
 *
 * Rien de ce qui est lu n'existe dans le produit sans validation humaine : la
 * recherche **préremplit un formulaire**, elle n'enregistre pas.
 */

export class UrlRefusee extends Error {}

/** « prometis.ch », « www.prometis.ch/contact » → URL https complète. */
export function normaliserUrl(brut: string): URL {
  const propre = brut.trim();
  if (!propre) throw new UrlRefusee('Indiquez l’adresse du site.');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(propre) ? propre : `https://${propre}`);
  } catch {
    throw new UrlRefusee('Cette adresse de site n’est pas valable.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRefusee('Seules les adresses http et https se consultent.');
  }
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) {
    throw new UrlRefusee('Cette adresse de site n’est pas valable.');
  }
  url.hash = '';
  return url;
}

/**
 * Une adresse IP qui n'appartient à personne sur Internet : boucle locale,
 * réseaux privés, lien-local (dont 169.254.169.254, les métadonnées des
 * hébergeurs), et leurs équivalents IPv6.
 */
export function adressePrivee(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1' || v6 === '::') return true;
  // Adresses mappées IPv4 (::ffff:10.0.0.1), uniques locales (fc00::/7),
  // lien-local (fe80::/10).
  if (v6.startsWith('::ffff:')) return adressePrivee(v6.slice(7));
  return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

const BALISES_MUETTES = /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ENTITES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ocirc: 'ô',
  ecirc: 'ê',
};

/** Le texte visible d'une page, dans l'ordre où il se lit. */
export function texteDuHtml(html: string, maxCaracteres = 12_000): string {
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const description =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '';

  const corps = html
    .replace(BALISES_MUETTES, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return [titre, description, corps]
    .join('\n')
    .replace(/&([a-z#0-9]+);/gi, (entier, nom: string) => ENTITES[nom.toLowerCase()] ?? entier)
    .replace(/[ \t\u00a0\u202f]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
    .slice(0, maxCaracteres);
}

/** Les pages qui portent l'adresse et l'IDE, quand la page d'accueil se tait. */
export const PAGES_UTILES = ['/contact', '/impressum', '/kontakt', '/mentions-legales'];
