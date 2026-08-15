import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../lib/session';
import { AppHeader, type Me } from './components/app-header';

interface OperationListItem {
  id: number;
  nom: string;
  statut: string;
  commune: string | null;
  canton: string | null;
  commercialisationActive: boolean;
  nbBiens: number;
}

interface MesDroits {
  role: string;
  estAdministrateur: boolean;
  modulesActifs: string[];
  operations: { id: number; nom: string; accessLevel: string; modules: string[] }[];
}

const LIBELLE_NIVEAU: Record<string, string> = {
  READ_ONLY: 'lecture',
  OPERATE: 'saisie',
  MANAGE: 'gestion',
};

const lisible = (m: string) => m.toLowerCase().replace(/_/g, ' ');

/**
 * Deux périmètres distincts, qu'il ne faut pas confondre :
 *   · ce que la SOCIÉTÉ a activé — son profil détermine ce qui existe ;
 *   · ce à quoi CE membre a droit — sa restriction par module.
 * Un intervenant externe voit les 18 modules d'un promoteur mais n'en touche
 * que trois : afficher le premier sans le second serait trompeur.
 */
function Perimetre({ droits }: { droits: MesDroits }) {
  const modulesDuMembre = [...new Set(droits.operations.flatMap((o) => o.modules))].sort();

  return (
    <>
      {modulesDuMembre.length > 0 && (
        <section>
          <h2>Votre périmètre</h2>
          <p className="note">
            Votre accès est restreint à ces modules sur les promotions qui vous sont confiées. Les
            autres routes vous sont refusées par l&apos;API, pas seulement masquées ici.
          </p>
          <div className="puces">
            {modulesDuMembre.map((m) => (
              <span key={m} className="puce accent">
                {lisible(m)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Modules actifs sur cette société</h2>
        <p className="note">
          Le profil de la société détermine ce qui existe. Une entreprise générale n&apos;a pas de
          surcouche commercialisation — ce n&apos;est pas un menu caché, la route n&apos;est pas
          servie.
        </p>
        <div className="puces">
          {droits.modulesActifs.map((m) => (
            <span key={m} className="puce">
              {lisible(m)}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

export default async function Home() {
  const token = await getToken();
  if (!token) redirect('/login');

  // Pas d'espace choisi : le jeton n'ouvre encore aucune donnée métier.
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const [me, operations, droits] = await Promise.all([
    apiGet<Me>('/auth/me'),
    apiGet<OperationListItem[]>('/operations'),
    apiGet<MesDroits>('/acces/mes-droits'),
  ]);

  if (!me) redirect('/login');

  const niveauParOperation = new Map(droits?.operations.map((o) => [o.id, o]) ?? []);

  // Le bouton suit le rôle. L'API refuse de toute façon — mais proposer une
  // action qui finira en 403 fait perdre le temps de la saisie.
  const peutCreer = ['OWNER', 'ADMIN', 'CHEF_PROJET'].includes(me.membership?.role ?? '');

  return (
    <main>
      <AppHeader me={me} actif="operations" />

      <div className="page-header">
        <h1>Promotions</h1>
        <span className="contexte">{me.societe?.raisonSociale}</span>
        {peutCreer && (
          <Link href="/promotions/nouvelle" className="action-entete">
            Nouvelle promotion
          </Link>
        )}
      </div>

      <section>
        {operations === null ? (
          <p className="ko">Lecture impossible.</p>
        ) : operations.length === 0 ? (
          <p>
            Aucune promotion ne vous a été confiée dans cet espace. Un administrateur peut vous en
            ouvrir l&apos;accès depuis l&apos;écran Droits d&apos;accès.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Promotion</th>
                <th>Commune</th>
                <th>Statut</th>
                <th>Biens</th>
                <th>Votre accès</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((o) => {
                const acces = niveauParOperation.get(o.id);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/operations/${o.id}`}>{o.nom}</Link>
                    </td>
                    <td>
                      {o.commune ?? '—'}
                      {o.canton ? ` (${o.canton})` : ''}
                    </td>
                    <td>{o.statut.toLowerCase().replace('_', ' ')}</td>
                    <td>{o.nbBiens}</td>
                    <td>
                      {acces ? LIBELLE_NIVEAU[acces.accessLevel] : '—'}
                      {acces && acces.modules.length > 0 && (
                        <span className="meta"> · {acces.modules.length} modules</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {droits && <Perimetre droits={droits} />}
    </main>
  );
}
