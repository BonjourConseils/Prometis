import { config as loadDotenv } from 'dotenv';

loadDotenv();

export const API = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
export const MOT_DE_PASSE = 'Prometis!2026';

export interface Reponse<T> {
  status: number;
  ok: boolean;
  body: T;
}

export async function appel<T = unknown>(
  chemin: string,
  options: { methode?: string; token?: string; corps?: unknown } = {},
): Promise<Reponse<T>> {
  const res = await fetch(`${API}${chemin}`, {
    method: options.methode ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
  });

  const body = (await res.json().catch(() => null)) as T;
  return { status: res.status, ok: res.ok, body };
}

export interface WorkspaceSummary {
  membershipId: number;
  societeId: number;
  role: string;
  raisonSociale: string;
  profil: string;
  modulesActifs: string[];
}

/** Jeton d'identité (sans espace de travail) + espaces disponibles. */
export async function connexion(email: string, motDePasse = MOT_DE_PASSE) {
  const res = await appel<{ accessToken: string; workspaces: WorkspaceSummary[] }>('/auth/login', {
    methode: 'POST',
    corps: { email, motDePasse },
  });
  if (!res.ok) throw new Error(`Connexion échouée pour ${email} : ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Jeton portant un espace de travail. */
export async function jetonPourEspace(email: string, societeId: number): Promise<string> {
  const { accessToken } = await connexion(email);
  const res = await appel<{ accessToken: string }>('/auth/workspace', {
    methode: 'POST',
    token: accessToken,
    corps: { societeId },
  });
  if (!res.ok) {
    throw new Error(`Espace ${societeId} refusé à ${email} : ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

export const COMPTES = {
  christophe: 'christophe@cbpromotions.ch',
  julie: 'julie@cbpromotions.ch',
  marc: 'm.girard@constructa.ch',
} as const;

export const CB = 1;
export const CONSTRUCTA = 2;

/** L'API est-elle joignable ? Les tests d'API sont ignorés sinon. */
export async function apiDisponible(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
