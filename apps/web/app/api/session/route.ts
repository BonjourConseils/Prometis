import { cookies } from 'next/headers';
import { API, SESSION_COOKIE, SESSION_MAX_AGE } from '../../../lib/session';

interface ReponseAuth {
  mfaRequis?: boolean;
  defiToken?: string;
  accessToken?: string;
}

/**
 * Connexion, en une ou deux étapes.
 *
 * Le formulaire ne parle jamais directement à l'API : il passe par ce
 * gestionnaire, qui dépose le jeton dans un cookie httpOnly. Le navigateur ne
 * voit donc jamais le jeton en JavaScript.
 *
 * Deux corps possibles :
 *   · `{ email, motDePasse }` → `/auth/login` ;
 *   · `{ defiToken, code }`   → `/auth/mfa/verifier`, quand le compte porte
 *     un second facteur.
 *
 * Le **jeton de défi** rendu par la première étape traverse le navigateur, et
 * c'est acceptable : il n'ouvre aucune route, il ne vaut que présenté avec un
 * code valide, et il expire en quelques minutes. Le déposer en cookie
 * httpOnly reviendrait à donner un cookie de session à quelqu'un qui n'a pas
 * fini de s'authentifier.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { defiToken?: string };
  const etapeMfa = typeof body.defiToken === 'string';

  const res = await fetch(`${API}${etapeMfa ? '/auth/mfa/verifier' : '/auth/login'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const data = (await res.json()) as ReponseAuth;
  if (!res.ok) return Response.json(data, { status: res.status });

  // Second facteur attendu : rien à déposer, on renvoie le défi au formulaire.
  if (data.mfaRequis || !data.accessToken) {
    return Response.json({ mfaRequis: true, defiToken: data.defiToken });
  }

  const { accessToken, ...reste } = data;
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
