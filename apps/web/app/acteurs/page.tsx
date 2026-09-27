import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { lisible } from '../../lib/format';
import { AjouterActeur, TableauActeurs } from './saisie';

interface Acteur {
  id: number;
  type: string;
  typeLibre: string | null;
  societeNom: string | null;
  nom: string | null;
  prenom: string | null;
  localite: string | null;
  email: string | null;
  telephone: string | null;
  siteWeb: string | null;
  ide: string | null;
  _count: { operationActeurs: number };
}

/**
 * Annuaire des acteurs — au niveau de la société, pas de la promotion.
 * Le même notaire sert plusieurs promotions : c'est tout l'intérêt.
 */
export default async function ActeursPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [acteurs, moi] = await Promise.all([apiGet<Acteur[]>('/acteurs'), apiGet<Me>('/auth/me')]);
  // Tenir l'annuaire relève de l'administration : c'est un bien commun de la
  // société, pas la fiche d'un intervenant de passage.
  const tenir = ['OWNER', 'ADMIN', 'CHEF_PROJET'].includes(moi?.membership?.role ?? '');

  if (acteurs === null) {
    return (
      <main>
        <AppHeader me={me} actif="acteurs" />
        <section>
          <h2>Acteurs</h2>
          <p>
            Le module Acteurs n&apos;est pas accessible avec votre rôle ou n&apos;est pas activé sur
            cette société.
          </p>
        </section>
      </main>
    );
  }

  // Regroupement par type : un annuaire se lit par métier, pas par ordre
  // d'ajout.
  const parType = new Map<string, Acteur[]>();
  for (const acteur of acteurs) {
    const liste = parType.get(acteur.type) ?? [];
    liste.push(acteur);
    parType.set(acteur.type, liste);
  }

  return (
    <main>
      <AppHeader me={me} actif="acteurs" />

      <section>
        <h2>Annuaire des acteurs</h2>
        <p className="note">
          {acteurs.length} intervenants enregistrés pour {me.societe?.raisonSociale}. Ils sont
          réutilisables sur toutes les promotions de la société.
        </p>
        {tenir && <AjouterActeur />}
      </section>

      {[...parType.entries()].map(([type, liste]) => (
        <section key={type}>
          <h2>
            {lisible(type)} — {liste.length}
          </h2>
          <TableauActeurs acteurs={liste} tenir={tenir} />
        </section>
      ))}
    </main>
  );
}
