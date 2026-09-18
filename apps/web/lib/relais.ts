import { headers } from 'next/headers';

/**
 * Ce que le relais transmet à l'API sur le client réel.
 *
 * Le navigateur ne parle jamais à l'API ; vue d'elle, chaque utilisateur a
 * l'adresse de ce serveur Next. Sans cette transmission, la limite de
 * tentatives de connexion par adresse bloquerait tout le monde au premier
 * attaquant, et le journal d'audit inscrirait partout la même IP.
 *
 * L'API ne croit l'adresse que si elle arrive avec `RELAIS_SECRET`, qu'elle
 * partage avec nous seuls — elle est aussi joignable directement, et un
 * en-tête d'IP, n'importe qui peut l'écrire.
 *
 * L'adresse retenue est la **dernière** de `X-Forwarded-For` : c'est celle
 * qu'ajoute le proxy placé devant Next. Les précédentes viennent du client, qui
 * peut y écrire ce qu'il veut. Cela suppose **un seul** proxy devant Next.
 */
export async function entetesRelais(): Promise<Record<string, string>> {
  const entrants = await headers();
  const navigateur = entrants.get('user-agent');
  const base: Record<string, string> = navigateur ? { 'user-agent': navigateur.slice(0, 200) } : {};

  const secret = process.env.RELAIS_SECRET;
  if (!secret) return base;

  const chaine = entrants.get('x-forwarded-for');
  const ip = chaine
    ? chaine
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
        .at(-1)
    : (entrants.get('x-real-ip') ?? undefined);
  if (!ip) return base;

  return { ...base, 'x-prometis-relais': secret, 'x-prometis-client-ip': ip };
}
