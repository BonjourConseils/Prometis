import { cookies } from 'next/headers';
import { API, SESSION_COOKIE } from '../../../../lib/session';

/**
 * Relais unique vers l'API, pour tous les formulaires de l'application.
 *
 * Le jeton vit dans un cookie **httpOnly** : le navigateur ne peut pas le
 * lire, donc un composant client ne peut pas appeler l'API directement. Ce
 * relais le récupère côté serveur et rattache l'en-tête d'autorisation.
 *
 * Il ne fait que transmettre — aucune validation, aucun contrôle de droit.
 * C'est délibéré : les refaire ici donnerait deux endroits où la règle peut
 * diverger, et c'est l'API qui porte la RLS, les rôles et les règles métier.
 * Un chemin qu'un utilisateur n'a pas le droit d'appeler lui répond 403
 * exactement comme s'il l'appelait en direct.
 *
 * **Protection contre le CSRF** : le cookie de session est posé en
 * `SameSite=lax`, ce qui empêche le navigateur de l'envoyer sur une requête
 * POST venue d'un autre site. Sans cela, ce relais serait un proxy
 * authentifié utilisable depuis n'importe quelle page.
 */
async function relayer(request: Request, segments: string[]): Promise<Response> {
  const jeton = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!jeton) return Response.json({ message: 'Session expirée.' }, { status: 401 });

  // Les segments viennent du routeur, jamais d'un corps de requête : ils ne
  // peuvent contenir ni `..` ni d'hôte. On refuse tout de même une tentative
  // d'absolu, qui ne pourrait venir que d'un appel forgé.
  const chemin = segments.join('/');
  if (chemin.startsWith('http') || chemin.includes('..')) {
    return Response.json({ message: 'Chemin invalide.' }, { status: 400 });
  }

  const requete = new URL(request.url);
  const corps = request.method === 'GET' ? undefined : await request.text();

  const res = await fetch(`${API}/${chemin}${requete.search}`, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
    body: corps || undefined,
    cache: 'no-store',
  });

  const texte = await res.text();
  return new Response(texte || '{}', {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Contexte = { params: Promise<{ chemin: string[] }> };

export async function GET(request: Request, { params }: Contexte): Promise<Response> {
  return relayer(request, (await params).chemin);
}

export async function POST(request: Request, { params }: Contexte): Promise<Response> {
  return relayer(request, (await params).chemin);
}

export async function PATCH(request: Request, { params }: Contexte): Promise<Response> {
  return relayer(request, (await params).chemin);
}

export async function DELETE(request: Request, { params }: Contexte): Promise<Response> {
  return relayer(request, (await params).chemin);
}
