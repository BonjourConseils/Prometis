import { API } from '../../../../lib/session';
import { entetesRelais } from '../../../../lib/relais';

/**
 * Accepter une invitation : relais sans session, vers une seule route de
 * l'API. Le jeton est contrôlé ici comme là-bas — rien d'autre n'est relayé.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ jeton: string }> },
): Promise<Response> {
  const { jeton } = await params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(jeton)) {
    return Response.json({ message: 'Lien invalide.' }, { status: 404 });
  }
  const res = await fetch(`${API}/invitations/${jeton}/accepter`, {
    method: 'POST',
    headers: { ...(await entetesRelais()), 'Content-Type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
  });
  const data: unknown = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
