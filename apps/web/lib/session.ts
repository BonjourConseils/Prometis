import { cookies } from 'next/headers';

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Le jeton vit dans un cookie httpOnly, jamais dans localStorage : du code
 * tiers injecté dans la page ne doit pas pouvoir le lire. Les composants
 * serveur le relisent et le passent à l'API en Bearer.
 */
export const SESSION_COOKIE = 'prometis_session';
export const SESSION_MAX_AGE = 60 * 60 * 8;

export interface TokenPayload {
  sub: number;
  email: string;
  /** Présent seulement une fois l'espace de travail choisi. */
  sid?: number;
  role?: string;
}

/**
 * Lecture *non vérifiée* du contenu du jeton.
 *
 * Le front s'en sert uniquement pour savoir où rediriger (connexion, choix
 * d'espace, application). Toute décision d'autorisation reste côté API, qui
 * vérifie la signature.
 */
export function lirePayload(token: string): TokenPayload | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  return fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/** Renvoie `null` plutôt que de lever : un 403 est une information à afficher. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
