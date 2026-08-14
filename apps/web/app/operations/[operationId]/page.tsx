import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../lib/session';
import { AppHeader, type Me } from '../../components/app-header';
import { GROUPES_CFC, chf, date, lisible, montant, nombre, pourcentage } from '../../../lib/format';

interface Operation {
  id: number;
  nom: string;
  description: string | null;
  commune: string | null;
  canton: string | null;
  statut: string;
  modeRealisation: string | null;
  commercialisationActive: boolean;
  dateDebut: string | null;
  dateLivraisonPrevue: string | null;
  _count: { biens: number; parcelles: number; cfcNodes: number };
}

interface Bilan {
  couts: {
    total: string;
    reserves: string;
    horsReserves: string;
    parGroupeCfc: { groupe: string; montant: string }[];
  };
  recettes: { total: string; lots: string; parkings: string; nombreLots: number };
  marge: string;
  tauxMargePct: string | null;
  budgetVersion: { id: number; libelle: string } | null;
}

interface Rattachement {
  id: number;
  role: string;
  estMandataireGeneral: boolean;
  suitLeProjet: boolean;
  montantMandat: string | null;
  acteur: {
    id: number;
    type: string;
    societeNom: string | null;
    nom: string | null;
    prenom: string | null;
    email: string | null;
    localite: string | null;
  };
}

export default async function FicheOperation({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  // `null` distingue « refusé » de « vide » : une EG n'a pas de bilan
  // promoteur, et ce n'est pas une donnée manquante.
  const [bilan, acteurs] = await Promise.all([
    apiGet<Bilan>(`/operations/${operationId}/bilan`),
    apiGet<Rattachement[]>(`/operations/${operationId}/acteurs`),
  ]);

  const margePositive = Number(bilan?.marge ?? 0) >= 0;

  return (
    <main>
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span> {operation.nom}
      </div>

      <section>
        <h2>Fiche opération</h2>
        <div className="fiche">
          <dl>
            <dt>Commune</dt>
            <dd>
              {operation.commune ?? '—'}
              {operation.canton ? ` (${operation.canton})` : ''}
            </dd>
            <dt>Statut</dt>
            <dd>{lisible(operation.statut)}</dd>
            <dt>Mode de réalisation</dt>
            <dd>{lisible(operation.modeRealisation)}</dd>
            <dt>Début des travaux</dt>
            <dd>{date(operation.dateDebut)}</dd>
            <dt>Livraison prévue</dt>
            <dd>{date(operation.dateLivraisonPrevue)}</dd>
            <dt>Commercialisation</dt>
            <dd>{operation.commercialisationActive ? 'active' : 'désactivée'}</dd>
          </dl>
        </div>
        {operation.description && <p className="note">{operation.description}</p>}
        <p className="note">
          {operation._count.biens} biens · {operation._count.parcelles} parcelles ·{' '}
          {operation._count.cfcNodes} postes CFC ·{' '}
          <Link href={`/operations/${operation.id}/budget`}>Budget CFC</Link> ·{' '}
          <Link href={`/operations/${operation.id}/registre-ppe`}>Registre PPE</Link>
        </p>
      </section>

      {bilan === null ? (
        <section>
          <h2>Bilan promoteur</h2>
          <p>
            Indisponible sur cette opération — soit la commercialisation y est désactivée, soit le
            module n&apos;est pas activé pour cette société.
          </p>
        </section>
      ) : (
        <section>
          <h2>Bilan promoteur</h2>
          <p className="note">
            Coûts du budget « {bilan.budgetVersion?.libelle ?? 'aucun budget courant'} » contre
            recettes des lots et de leurs places de parc.
          </p>

          <div className="kpis">
            <div className="kpi">
              <span className="etiquette">Coûts</span>
              <span className="valeur">{chf(bilan.couts.total)}</span>
              <span className="meta">dont {chf(bilan.couts.reserves)} de réserves</span>
            </div>
            <div className="kpi">
              <span className="etiquette">Recettes</span>
              <span className="valeur">{chf(bilan.recettes.total)}</span>
              <span className="meta">
                {montant(bilan.recettes.lots)} lots + {montant(bilan.recettes.parkings)} parkings
              </span>
            </div>
            <div className={`kpi ${margePositive ? 'positif' : 'negatif'}`}>
              <span className="etiquette">Marge</span>
              <span className="valeur">{chf(bilan.marge)}</span>
              <span className="meta">
                {bilan.tauxMargePct === null
                  ? 'aucune recette'
                  : `${pourcentage(bilan.tauxMargePct)} des recettes`}
              </span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Groupe CFC</th>
                <th className="droite">Budgété</th>
                <th className="droite">Part</th>
              </tr>
            </thead>
            <tbody>
              {bilan.couts.parGroupeCfc.map((g) => {
                const part = (Number(g.montant) / Number(bilan.couts.total)) * 100;
                return (
                  <tr key={g.groupe}>
                    <td>
                      <code>{g.groupe}</code> {GROUPES_CFC[g.groupe] ?? '—'}
                    </td>
                    <td className="droite">{montant(g.montant)}</td>
                    <td className="droite meta">{part.toFixed(1)} %</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>Total</td>
                <td className="droite">{montant(bilan.couts.total)}</td>
                <td className="droite meta">100 %</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {acteurs !== null && acteurs.length > 0 && (
        <section>
          <h2>Équipe du projet</h2>
          <table>
            <thead>
              <tr>
                <th>Rôle</th>
                <th>Société</th>
                <th>Contact</th>
                <th className="droite">Mandat</th>
              </tr>
            </thead>
            <tbody>
              {acteurs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {lisible(r.role)}
                    {r.estMandataireGeneral && <span className="badge">mandataire général</span>}
                  </td>
                  <td>{r.acteur.societeNom ?? '—'}</td>
                  <td>
                    {[r.acteur.prenom, r.acteur.nom].filter(Boolean).join(' ') || '—'}
                    {r.acteur.email && (
                      <>
                        <br />
                        <span className="meta">{r.acteur.email}</span>
                      </>
                    )}
                  </td>
                  <td className="droite">{r.montantMandat ? montant(r.montantMandat) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            Les surfaces et quotes-parts détaillées sont dans le{' '}
            <Link href={`/operations/${operation.id}/registre-ppe`}>registre PPE</Link>. Nombre de
            lots : {bilan?.recettes.nombreLots ?? nombre(null)}.
          </p>
        </section>
      )}
    </main>
  );
}
