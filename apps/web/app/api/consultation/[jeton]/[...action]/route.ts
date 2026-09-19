import { cookies } from 'next/headers';
import { API } from '../../../../../lib/session';
import { entetesRelais } from '../../../../../lib/relais';
import {
  COOKIE_CONSULTATION,
  DUREE_CONSULTATION,
  jetonValide,
} from '../../../../../lib/consultation';

/**
 * Relais de l'espace entreprise — séparé de celui de l'application.
 *
 * Il ne transmet que les actions de la consultation, vers `/consultation/…`
 * et nulle part ailleurs : une session entreprise ne peut atteindre aucune
 * autre route de l'API, même en forgeant un chemin. La session voyage dans
 * un en-tête dédié, lu depuis un cookie httpOnly que le navigateur ne voit
 * jamais : aucun script de la page ne peut la lire.
 */
const ACTIONS_POST = new Set(['code', 'session', 'questions', 'offre', 'decliner']);

async function relayer(request: Request, jeton: string, action: string[]): Promise<Response> {
  if (!jetonValide(jeton)) return Response.json({ message: 'Lien invalide.' }, { status: 404 });

  let chemin: string;
  if (
    request.method === 'GET' &&
    action.length === 2 &&
    action[0] === 'documents' &&
    /^\d+$/.test(action[1]!)
  ) {
    chemin = `documents/${action[1]}`;
  } else if (request.method === 'POST' && action.length === 1 && ACTIONS_POST.has(action[0]!)) {
    chemin = action[0]!;
  } else {
    return Response.json({ message: 'Action inconnue.' }, { status: 404 });
  }

  const jar = await cookies();
  const session = jar.get(COOKIE_CONSULTATION)?.value;
  const typeEntrant = request.headers.get('content-type') ?? '';
  const multipart = typeEntrant.startsWith('multipart/form-data');

  const res = await fetch(`${API}/consultation/${jeton}/${chemin}`, {
    method: request.method,
    headers: {
      ...(await entetesRelais()),
      ...(request.method === 'POST'
        ? { 'Content-Type': multipart ? typeEntrant : 'application/json' }
        : {}),
      ...(session ? { 'x-consultation-session': session } : {}),
    },
    body:
      request.method === 'POST'
        ? multipart
          ? await request.arrayBuffer()
          : (await request.text()) || '{}'
        : undefined,
    cache: 'no-store',
  });

  // Le code échangé contre une session : elle part dans le cookie, jamais
  // dans la réponse lue par la page.
  if (chemin === 'session' && res.ok) {
    const { session: nouvelle } = (await res.json()) as { session: string };
    jar.set(COOKIE_CONSULTATION, nouvelle, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: DUREE_CONSULTATION,
      secure: process.env.NODE_ENV === 'production',
    });
    return Response.json({ ouverte: true });
  }

  const type = res.headers.get('content-type') ?? '';
  if (res.ok && !type.includes('application/json')) {
    const entetes = new Headers();
    for (const nom of [
      'content-type',
      'content-length',
      'content-disposition',
      'content-security-policy',
      'x-content-type-options',
      'cache-control',
    ]) {
      const v = res.headers.get(nom);
      if (v) entetes.set(nom, v);
    }
    return new Response(res.body, { status: res.status, headers: entetes });
  }
  const data: unknown = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}

type Contexte = { params: Promise<{ jeton: string; action: string[] }> };

export async function GET(request: Request, { params }: Contexte): Promise<Response> {
  const { jeton, action } = await params;
  return relayer(request, jeton, action);
}

export async function POST(request: Request, { params }: Contexte): Promise<Response> {
  const { jeton, action } = await params;
  return relayer(request, jeton, action);
}
