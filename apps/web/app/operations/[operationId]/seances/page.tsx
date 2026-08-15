import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date, lisible } from '../../../../lib/format';

interface Seance {
  id: number;
  titre: string;
  numero: string | null;
  type: string;
  statut: string;
  date: string | null;
  lieu: string | null;
  participants: { id: number; nom: string | null; organisation: string | null; present: boolean }[];
  _count: { points: number; documents: number };
}

interface Action {
  id: number;
  titre: string;
  responsable: string | null;
  echeance: string | null;
  statut: string;
  enRetard: boolean;
  seance: { id: number; titre: string; numero: string | null; date: string | null };
}

interface Actions {
  total: number;
  enRetard: number;
  sansEcheance: number;
  points: Action[];
}

interface Operation {
  id: number;
  nom: string;
}

/**
 * Séances et procès-verbaux.
 *
 * Les **actions ouvertes** viennent en premier, avant la liste des séances.
 * C'est l'inverse de l'ordre chronologique, et c'est voulu : un PV qu'on
 * relit séance après séance ne dit pas ce qui traîne depuis trois réunions.
 */
export default async function SeancesPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'seances';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [seances, actions] = await Promise.all([
    apiGet<Seance[]>(`/operations/${operationId}/seances`),
    apiGet<Actions>(`/operations/${operationId}/seances/actions`),
  ]);

  if (seances === null || actions === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Séances &amp; PV</h2>
          <p>
            Le module Séances n&apos;est pas activé sur cette société, ou votre accès à
            l&apos;opération ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Séances & PV"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <section>
        <p className="note">
          {seances.length} séance{seances.length > 1 ? 's' : ''} · {actions.total} action
          {actions.total > 1 ? 's' : ''} ouverte{actions.total > 1 ? 's' : ''}
          {actions.enRetard > 0 && (
            <>
              , dont <strong>{actions.enRetard} en retard</strong>
            </>
          )}
          {actions.sansEcheance > 0 && <> · {actions.sansEcheance} sans échéance</>}
        </p>
      </section>

      {actions.total > 0 && (
        <section>
          <h2>Actions ouvertes</h2>
          <table>
            <thead>
              <tr>
                <th>Point</th>
                <th>Responsable</th>
                <th>Échéance</th>
                <th>Séance</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {actions.points.map((a) => (
                <tr key={a.id}>
                  <td>{a.titre}</td>
                  <td>{a.responsable ?? <span className="meta">non désigné</span>}</td>
                  <td>{a.echeance ? date(a.echeance) : <span className="meta">sans</span>}</td>
                  <td>
                    <span className="meta">
                      {a.seance.numero ?? a.seance.titre} · {date(a.seance.date)}
                    </span>
                  </td>
                  <td>{a.enRetard ? <strong>en retard</strong> : lisible(a.statut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Séances</h2>
        {seances.length === 0 ? (
          <p>Aucune séance enregistrée.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Séance</th>
                <th>Type</th>
                <th>Date</th>
                <th>Lieu</th>
                <th className="droite">Présents</th>
                <th className="droite">Points</th>
                <th>État</th>
                <th className="droite">PV</th>
              </tr>
            </thead>
            <tbody>
              {seances.map((s) => {
                const presents = s.participants.filter((p) => p.present).length;
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.numero ?? `Séance ${s.id}`}</strong>
                      <br />
                      <span className="meta">{s.titre}</span>
                    </td>
                    <td>{lisible(s.type)}</td>
                    <td>{date(s.date)}</td>
                    <td>{s.lieu ?? '—'}</td>
                    <td className="droite">
                      {presents}/{s.participants.length}
                    </td>
                    <td className="droite">{s._count.points}</td>
                    <td>{lisible(s.statut)}</td>
                    <td className="droite">
                      {s._count.documents > 0 ? (
                        s._count.documents
                      ) : (
                        <span className="meta">à générer</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
