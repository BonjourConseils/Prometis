import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../lib/session';
import { AppHeader, type Me } from '../../components/app-header';
import { PageHeader } from '../../components/page-header';
import { ResultatPaiement, type Resultat } from '../facturation';

/**
 * Le retour de Stripe Checkout.
 *
 * La page réconcilie la session elle-même — elle ne dépend pas du webhook,
 * qui peut arriver après elle. Elle dit ce qui a été obtenu, ce qui a été
 * réglé (souvent : rien, pendant l'essai), et la suite.
 */
export default async function ResultatPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');
  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const { session_id } = await searchParams;
  const resultat = session_id
    ? await apiGet<Resultat>(`/facturation/retour?session_id=${encodeURIComponent(session_id)}`)
    : null;

  return (
    <main>
      <AppHeader me={me} actif="modules" />
      <PageHeader titre="Souscription" contexte={me.societe?.raisonSociale} />
      <section>
        {resultat ? (
          <ResultatPaiement r={resultat} />
        ) : (
          <p className="ko">
            Cette session de paiement est introuvable pour votre société. Si un montant a été
            prélevé, écrivez-nous à contact@prometis.ch.
          </p>
        )}
        <p>
          <Link href="/modules">Retour aux modules</Link>
        </p>
      </section>
    </main>
  );
}
