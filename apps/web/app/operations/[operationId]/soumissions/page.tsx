import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date, lisible, montant } from '../../../../lib/format';

interface Soumission {
  id: number;
  intitule: string;
  corpsMetier: string | null;
  statut: string;
  dateLimite: string | null;
  cfcNode: { id: number; code: string; libelle: string } | null;
  adjudication: {
    id: number;
    montantAdjuge: string;
    dateDecision: string;
    offre: { entreprise: { id: number; nom: string } };
    contrat: { id: number; reference: string | null; statut: string } | null;
  } | null;
  _count: { offres: number; invitations: number };
}

interface Operation {
  id: number;
  nom: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'brouillon',
  ENVOYEE: 'envoyée',
  OUVERTE: 'ouverte',
  EN_COMPARAISON: 'en comparaison',
  ADJUGEE: 'adjugée',
  INFRUCTUEUSE: 'infructueuse',
  ANNULEE: 'annulée',
};

export default async function SoumissionsPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'soumissions';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const soumissions = await apiGet<Soumission[]>(`/operations/${operationId}/soumissions`);

  if (soumissions === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Soumissions</h2>
          <p>Votre accès à cette opération ne couvre pas les soumissions.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Soumissions"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Soumissions
      </div>

      <section>
        <h2>Appels d&apos;offres</h2>
        {soumissions.length === 0 ? (
          <p>Aucune soumission sur cette opération.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Soumission</th>
                <th>Poste CFC</th>
                <th>Statut</th>
                <th className="droite">Offres</th>
                <th>Adjudication</th>
              </tr>
            </thead>
            <tbody>
              {soumissions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/operations/${operation.id}/soumissions/${s.id}`}>
                      {s.intitule}
                    </Link>
                    {s.dateLimite && (
                      <>
                        <br />
                        <span className="meta">délai {date(s.dateLimite)}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {s.cfcNode ? (
                      <>
                        <code>{s.cfcNode.code}</code> {s.cfcNode.libelle}
                      </>
                    ) : (
                      <span className="meta">non rattachée</span>
                    )}
                  </td>
                  <td>{LIBELLE_STATUT[s.statut] ?? lisible(s.statut)}</td>
                  <td className="droite">
                    {s._count.offres} / {s._count.invitations}
                  </td>
                  <td>
                    {s.adjudication ? (
                      <>
                        {s.adjudication.offre.entreprise.nom} —{' '}
                        {montant(s.adjudication.montantAdjuge)}
                        <br />
                        <span className="meta">
                          {s.adjudication.contrat
                            ? `contrat ${s.adjudication.contrat.reference ?? s.adjudication.contrat.id} · ${lisible(s.adjudication.contrat.statut)}`
                            : 'contrat à générer'}
                        </span>
                      </>
                    ) : (
                      <span className="meta">en attente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
