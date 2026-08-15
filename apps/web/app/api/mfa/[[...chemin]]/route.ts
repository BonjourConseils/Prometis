import { cookies } from 'next/headers';
import { API, SESSION_COOKIE } from '../../../../lib/session';

/**
 * Relais des appels MFA vers l'API.
 *
 * Le jeton vit dans un cookie httpOnly : le composant client ne peut pas le
 * lire, donc il ne peut pas appeler l'API directement. Ce relais lit le
 * cookie côté serveur et rattache l'en-tête d'autorisation.
 *
 * Le chemin est **fermé** à une liste : sans elle, ce gestionnaire deviendrait
 * un proxy authentifié vers n'importe quelle route de l'API.
 */
const CHEMINS_AUTORISES: Record<string, string> = {
  '': '/auth/mfa',
  enrolement: '/auth/mfa/enrolement',
  activer: '/auth/mfa/activer',
};

async function relayer(request: Request, segments: string[] | undefined): Promise<Response> {
  const cle = (segments ?? []).join('/');
  const cible = CHEMINS_AUTORISES[cle];
  if (!cible) return Response.json({ message: 'Route inconnue.' }, { status: 404 });

  const jeton = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!jeton) return Response.json({ message: 'Session expirée.' }, { status: 401 });

  const corps = await request.text();
  const res = await fetch(`${API}${cible}`, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jeton}`,
    },
    body: corps || undefined,
    cache: 'no-store',
  });

  return Response.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ chemin?: string[] }> },
): Promise<Response> {
  return relayer(request, (await params).chemin);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chemin?: string[] }> },
): Promise<Response> {
  return relayer(request, (await params).chemin);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ chemin?: string[] }> },
): Promise<Response> {
  return relayer(request, (await params).chemin);
}
