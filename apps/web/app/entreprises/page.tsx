import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';
import { AjouterEntreprise, TableauEntreprises, type ValeursEntreprise } from './saisie';

/**
 * Le répertoire des entreprises — **de la société, pas d'une promotion**.
 *
 * Il vivait sous l'écran Soumissions d'une promotion, et c'était trompeur :
 * on y voyait sept entreprises sans avoir envoyé le moindre appel
 * d'offres. Elles n'étaient pas celles de cette promotion, mais celles de
 * l'annuaire du promoteur.
 *
 * Il a donc sa place ici, hors de toute promotion. Une entreprise consultée
 * sur un chantier reste disponible pour les suivants, avec son historique
 * d'offres et de contrats — c'est précisément ce qui fait sa valeur.
 */
export default async function EntreprisesPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const entreprises = await apiGet<ValeursEntreprise[]>('/entreprises');

  return (
    <main>
      <AppHeader me={me} actif="entreprises" />

      <PageHeader titre="Entreprises" contexte={me.societe?.raisonSociale} />

      <section>
        <h2>Répertoire</h2>
        {entreprises === null ? (
          <p className="note">
            Le module Soumissions n&apos;est pas activé sur cette société, ou votre accès ne le
            couvre pas.
          </p>
        ) : (
          <>
            <p className="note">
              Votre annuaire d&apos;entreprises, tenu une fois pour toutes vos promotions. Collez
              l&apos;adresse du site d&apos;une entreprise et l&apos;app remplit sa fiche — raison
              sociale, adresse, contact, IDE — que vous relisez avant d&apos;enregistrer.
              Les <strong>offres</strong> et les <strong>contrats</strong> comptent ce qu&apos;elle
              a déjà fait chez vous, tous chantiers confondus.
            </p>

            {entreprises.length === 0 ? (
              <p className="note">
                Aucune entreprise. Ajoutez-en une, ou laissez-les arriver au fil des appels
                d&apos;offres.
              </p>
            ) : (
              <TableauEntreprises entreprises={entreprises} />
            )}

            <AjouterEntreprise />
          </>
        )}
      </section>
    </main>
  );
}
