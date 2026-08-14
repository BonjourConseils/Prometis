import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { chf, montant } from '../../../../lib/format';

interface Colonnes {
  budgeteInitial: string;
  budgeteRevise: string;
  adjuge: string;
  commande: string;
  facture: string;
  paye: string;
}

interface Noeud {
  id: number;
  code: string;
  libelle: string;
  total: Colonnes;
  resteAEngager: string;
  resteADepenser: string;
  ecartBudgetFacture: string;
  projectionATerminaison: string;
  enfants: Noeud[];
}

interface VueBudget {
  versionAffichee: { libelle: string } | null;
  arbre: Noeud[];
  total: Colonnes & {
    resteAEngager: string;
    resteADepenser: string;
    reserves: string;
  };
}

interface Operation {
  id: number;
  nom: string;
}

function aplatir(noeuds: Noeud[], profondeur = 0): { noeud: Noeud; profondeur: number }[] {
  return noeuds.flatMap((noeud) => [
    { noeud, profondeur },
    ...aplatir(noeud.enfants, profondeur + 1),
  ]);
}

/** Un poste est en dépassement si son commandé excède son budget révisé. */
const enDepassement = (n: Noeud) => Number(n.total.commande) > Number(n.total.budgeteRevise);

export default async function EcartsPage({ params }: { params: Promise<{ operationId: string }> }) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const vue = await apiGet<VueBudget>(`/operations/${operationId}/budget`);

  if (vue === null) {
    return (
      <main>
        <AppHeader me={me} actif="operations" />
        <section>
          <h2>Écarts</h2>
          <p>Votre accès à cette opération ne couvre pas le budget.</p>
        </section>
      </main>
    );
  }

  const lignes = aplatir(vue.arbre);
  const depassements = lignes.filter(
    ({ noeud }) => enDepassement(noeud) && noeud.enfants.length === 0,
  );

  return (
    <main className="large">
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Écarts
      </div>

      <section>
        <h2>Le fil rouge financier</h2>
        <p className="note">
          Budget « {vue.versionAffichee?.libelle ?? '—'} ». Tous les montants sont hors taxe, y
          compris le payé — un règlement TTC est ramené à sa part hors taxe pour rester comparable.
        </p>

        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Budgété</span>
            <span className="valeur">{chf(vue.total.budgeteRevise)}</span>
            <span className="meta">dont {montant(vue.total.reserves)} de réserves</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Adjugé</span>
            <span className="valeur">{chf(vue.total.adjuge)}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Commandé</span>
            <span className="valeur">{chf(vue.total.commande)}</span>
            <span className="meta">reste à engager {montant(vue.total.resteAEngager)}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Facturé</span>
            <span className="valeur">{chf(vue.total.facture)}</span>
            <span className="meta">reste à dépenser {montant(vue.total.resteADepenser)}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Payé</span>
            <span className="valeur">{chf(vue.total.paye)}</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Dépassements</h2>
        {depassements.length === 0 ? (
          <p className="ok">Aucun poste dont le commandé dépasse son budget.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Poste</th>
                <th className="droite">Budgété</th>
                <th className="droite">Commandé</th>
                <th className="droite">Dépassement</th>
              </tr>
            </thead>
            <tbody>
              {depassements.map(({ noeud }) => (
                <tr key={noeud.id}>
                  <td>
                    <code>{noeud.code}</code> {noeud.libelle}
                  </td>
                  <td className="droite">{montant(noeud.total.budgeteRevise)}</td>
                  <td className="droite">{montant(noeud.total.commande)}</td>
                  <td className="droite ko">
                    {montant(
                      String(Number(noeud.total.commande) - Number(noeud.total.budgeteRevise)),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Par poste CFC</h2>
        <div className="tableau-large">
          <table>
            <thead>
              <tr>
                <th>Poste</th>
                <th className="droite">Budgété</th>
                <th className="droite">Adjugé</th>
                <th className="droite">Commandé</th>
                <th className="droite">Facturé</th>
                <th className="droite">Payé</th>
                <th className="droite">Reste à engager</th>
                <th className="droite">À terminaison</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map(({ noeud, profondeur }) => {
                const inactif = Number(noeud.total.budgeteRevise) === 0;
                return (
                  <tr
                    key={noeud.id}
                    className={
                      enDepassement(noeud)
                        ? 'depassement'
                        : profondeur === 0
                          ? 'groupe'
                          : inactif
                            ? 'attenue'
                            : ''
                    }
                  >
                    <td style={{ paddingLeft: `${profondeur * 1.25}rem` }}>
                      <code>{noeud.code}</code> {noeud.libelle}
                    </td>
                    <td className="droite">{montant(noeud.total.budgeteRevise)}</td>
                    <td className="droite">{montant(noeud.total.adjuge)}</td>
                    <td className="droite">{montant(noeud.total.commande)}</td>
                    <td className="droite">{montant(noeud.total.facture)}</td>
                    <td className="droite">{montant(noeud.total.paye)}</td>
                    <td className="droite">{montant(noeud.resteAEngager)}</td>
                    <td className="droite">{montant(noeud.projectionATerminaison)}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>Total opération</td>
                <td className="droite">{montant(vue.total.budgeteRevise)}</td>
                <td className="droite">{montant(vue.total.adjuge)}</td>
                <td className="droite">{montant(vue.total.commande)}</td>
                <td className="droite">{montant(vue.total.facture)}</td>
                <td className="droite">{montant(vue.total.paye)}</td>
                <td className="droite">{montant(vue.total.resteAEngager)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note">
          « À terminaison » retient le commandé quand il dépasse le budget, le budget sinon :
          c&apos;est le coût au dernier connu, celui sur lequel on raisonne en cours de chantier
          plutôt que sur un budget déjà périmé.
        </p>
      </section>
    </main>
  );
}
