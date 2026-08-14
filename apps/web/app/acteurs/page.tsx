import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { lisible } from '../../lib/format';

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
  ide: string | null;
  _count: { operationActeurs: number };
}

/**
 * Annuaire des acteurs — au niveau de la société, pas de l'opération.
 * Le même notaire sert plusieurs promotions : c'est tout l'intérêt.
 */
export default async function ActeursPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const acteurs = await apiGet<Acteur[]>('/acteurs');

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
          réutilisables sur toutes les opérations de la société.
        </p>
      </section>

      {[...parType.entries()].map(([type, liste]) => (
        <section key={type}>
          <h2>
            {lisible(type)} — {liste.length}
          </h2>
          <table>
            <thead>
              <tr>
                <th>Société</th>
                <th>Contact</th>
                <th>Localité</th>
                <th className="droite">Opérations</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.societeNom ?? '—'}</strong>
                    {a.ide && (
                      <>
                        <br />
                        <span className="meta">{a.ide}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {[a.prenom, a.nom].filter(Boolean).join(' ') || '—'}
                    {a.email && (
                      <>
                        <br />
                        <span className="meta">{a.email}</span>
                      </>
                    )}
                    {a.telephone && (
                      <>
                        <br />
                        <span className="meta">{a.telephone}</span>
                      </>
                    )}
                  </td>
                  <td>{a.localite ?? '—'}</td>
                  <td className="droite">{a._count.operationActeurs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
