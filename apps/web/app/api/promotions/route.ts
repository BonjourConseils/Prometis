import { cookies } from 'next/headers';
import { API, SESSION_COOKIE } from '../../../lib/session';

/**
 * Création d'une promotion.
 *
 * Le formulaire ne parle jamais directement à l'API : le jeton vit dans un
 * cookie httpOnly, que le navigateur ne peut pas lire. Ce relais le récupère
 * côté serveur et rattache l'en-tête d'autorisation.
 *
 * Il ne fait que transmettre : la validation, les droits et les règles
 * métier restent côté API. Refaire des contrôles ici donnerait deux endroits
 * où la règle peut diverger.
 */
export async function POST(request: Request): Promise<Response> {
  const jeton = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!jeton) return Response.json({ message: 'Session expirée.' }, { status: 401 });

  const res = await fetch(`${API}/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
    body: await request.text(),
    cache: 'no-store',
  });

  return Response.json(await res.json().catch(() => ({})), { status: res.status });
}
