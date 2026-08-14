import { cookies } from 'next/headers';
import { API, SESSION_COOKIE, SESSION_MAX_AGE } from '../../../lib/session';

/**
 * Connexion. Le formulaire ne parle jamais directement à l'API : il passe par
 * ce gestionnaire, qui dépose le jeton dans un cookie httpOnly. Le navigateur
 * ne voit donc jamais le jeton en JavaScript.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data: unknown = await res.json();
  if (!res.ok) return Response.json(data, { status: res.status });

  const { accessToken, ...reste } = data as { accessToken: string };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });

  return Response.json(reste);
}

export async function DELETE(): Promise<Response> {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ deconnecte: true });
}
