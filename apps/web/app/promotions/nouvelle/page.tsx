import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../lib/session';
import { AppHeader, type Me } from '../../components/app-header';
import { PageHeader } from '../../components/page-header';
import { FormulairePromotion } from './formulaire';

/**
 * Nouvelle promotion.
 *
 * Le rôle est vérifié ici **et** par l'API. Ce contrôle-ci n'est pas la
 * sécurité — c'est de la courtoisie : proposer un formulaire dont l'envoi
 * finira en 403 fait perdre le temps de sa saisie.
 */
export default async function NouvellePromotionPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const peutCreer = ['OWNER', 'ADMIN', 'CHEF_PROJET'].includes(me.membership?.role ?? '');

  return (
    <main>
      <AppHeader me={me} actif="operations" />

      <PageHeader titre="Nouvelle promotion" contexte={me.societe?.raisonSociale} />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span> Nouvelle
      </div>

      {!peutCreer ? (
        <section>
          <h2>Création réservée</h2>
          <p className="note">
            Votre rôle ne permet pas d&apos;ouvrir une promotion. Un propriétaire, un administrateur
            ou un chef de projet le peut.
          </p>
        </section>
      ) : (
        <section>
          <h2>Identité de la promotion</h2>
          <p className="note">
            Seul le nom est exigé — le reste se complète en route. Vous recevrez d&apos;office le
            droit de gestion sur la promotion créée : sans cela, vous ouvririez un dossier que vous
            ne verriez pas.
          </p>
          <FormulairePromotion />
        </section>
      )}
    </main>
  );
}
