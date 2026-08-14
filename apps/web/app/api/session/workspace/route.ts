import { cookies } from 'next/headers';
import { API, SESSION_COOKIE, SESSION_MAX_AGE } from '../../../../lib/session';

/**
 * Choix (ou changement) d'espace de travail.
 *
 * L'API revérifie en base que le compte appartient bien à cette société : le
 * cookie n'est remplacé que si elle l'accorde. Changer de société côté client
 * ne suffit donc jamais à changer de tenant.
 */
export async function POST(request: Request): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ message: 'Session expirée.' }, { status: 401 });

  const body: unknown = await request.json();

  const res = await fetch(`${API}/auth/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data: unknown = await res.json();
  if (!res.ok) return Response.json(data, { status: res.status });

  const { accessToken, workspace } = data as { accessToken: string; workspace: unknown };
  jar.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });

  return Response.json({ workspace });
}
