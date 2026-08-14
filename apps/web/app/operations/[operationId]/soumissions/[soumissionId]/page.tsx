import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../../lib/session';
import { AppHeader, type Me } from '../../../../components/app-header';
import { chf, date, montant, pourcentage } from '../../../../../lib/format';

interface OffreComparee {
  id: number;
  entrepriseNom: string;
  statut: string;
  dateReception: string | null;
  montantBrut: string | null;
  remisePct: string | null;
  montantNet: string | null;
  rang: number | null;
  ecartMoinsDisantPct: string | null;
  ecartBudget: string | null;
  ecartBudgetPct: string | null;
  notePrix: string | null;
  motifExclusion: string | null;
}

interface Comparaison {
  soumission: {
    id: number;
    intitule: string;
    corpsMetier: string | null;
    statut: string;
    dateLimite: string | null;
    cfcNode: { id: number; code: string; libelle: string } | null;
  };
  adjudication: { id: number; offreId: number; montantAdjuge: string } | null;
  offres: OffreComparee[];
  nombreComparables: number;
  moinsDisant: string | null;
  plusDisant: string | null;
  dispersion: string | null;
  dispersionPct: string | null;
  budgete: string | null;
  propositionOffreId: number | null;
}

interface Operation {
  id: number;
  nom: string;
}

export default async function ComparaisonPage({
  params,
}: {
  params: Promise<{ operationId: string; soumissionId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId, soumissionId } = await params;

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, c] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<Comparaison>(`/operations/${operationId}/soumissions/${soumissionId}/comparaison`),
  ]);

  if (!operation) notFound();
  if (c === null) {
    return (
      <main>
        <AppHeader me={me} actif="operations" />
        <section>
          <h2>Comparaison des offres</h2>
          <p>Votre accès à cette opération ne couvre pas les soumissions.</p>
        </section>
      </main>
    );
  }

  const classees = [...c.offres].sort(
    (a, b) => (a.rang ?? Number.MAX_SAFE_INTEGER) - (b.rang ?? Number.MAX_SAFE_INTEGER),
  );

  return (
    <main className="large">
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}/soumissions`}>Soumissions</Link>{' '}
        <span aria-hidden="true">›</span> Comparaison
      </div>

      <section>
        <h2>{c.soumission.intitule}</h2>
        <p className="note">
          {c.soumission.cfcNode && (
            <>
              Poste <code>{c.soumission.cfcNode.code}</code> {c.soumission.cfcNode.libelle} ·{' '}
            </>
          )}
          {c.nombreComparables} offre{c.nombreComparables > 1 ? 's' : ''} comparable
          {c.nombreComparables > 1 ? 's' : ''} sur {c.offres.length}
          {c.soumission.dateLimite && <> · délai {date(c.soumission.dateLimite)}</>}
        </p>

        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Budget du poste</span>
            <span className="valeur">{chf(c.budgete)}</span>
            <span className="meta">version courante, sous-postes compris</span>
          </div>
          <div className="kpi positif">
            <span className="etiquette">Moins-disant</span>
            <span className="valeur">{chf(c.moinsDisant)}</span>
            <span className="meta">
              {c.budgete && c.moinsDisant
                ? `${montant(String(Number(c.moinsDisant) - Number(c.budgete)))} vs budget`
                : '—'}
            </span>
          </div>
          <div className="kpi">
            <span className="etiquette">Dispersion</span>
            <span className="valeur">{chf(c.dispersion)}</span>
            <span className="meta">
              {c.dispersionPct ? `${pourcentage(c.dispersionPct)} entre extrêmes` : '—'}
            </span>
          </div>
        </div>
      </section>

      <section>
        <h2>Offres reçues</h2>
        <div className="tableau-large">
          <table>
            <thead>
              <tr>
                <th>Rang</th>
                <th>Entreprise</th>
                <th className="droite">Brut</th>
                <th className="droite">Remise</th>
                <th className="droite">Net</th>
                <th className="droite">vs moins-disant</th>
                <th className="droite">vs budget</th>
                <th className="droite">Note prix</th>
              </tr>
            </thead>
            <tbody>
              {classees.map((o) => {
                const adjugee = c.adjudication?.offreId === o.id;
                const proposee = !c.adjudication && c.propositionOffreId === o.id;
                return (
                  <tr key={o.id} className={o.motifExclusion ? 'attenue' : adjugee ? 'groupe' : ''}>
                    <td>{o.rang ?? '—'}</td>
                    <td>
                      {o.entrepriseNom}
                      {adjugee && <span className="badge">adjugée</span>}
                      {proposee && <span className="badge">proposition</span>}
                      {o.motifExclusion && (
                        <>
                          <br />
                          <span className="meta">{o.motifExclusion}</span>
                        </>
                      )}
                    </td>
                    <td className="droite">{montant(o.montantBrut)}</td>
                    <td className="droite">{o.remisePct ? pourcentage(o.remisePct) : '—'}</td>
                    <td className="droite">
                      <strong>{montant(o.montantNet)}</strong>
                    </td>
                    <td className="droite">
                      {o.ecartMoinsDisantPct ? `+${pourcentage(o.ecartMoinsDisantPct)}` : '—'}
                    </td>
                    <td
                      className={`droite ${Number(o.ecartBudgetPct ?? 0) > 0 ? 'ko' : Number(o.ecartBudgetPct ?? 0) < 0 ? 'ok' : ''}`}
                    >
                      {o.ecartBudgetPct ? pourcentage(o.ecartBudgetPct) : '—'}
                    </td>
                    <td className="droite">{o.notePrix ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {c.adjudication ? (
          <p className="note">
            Soumission adjugée à {chf(c.adjudication.montantAdjuge)}. Le montant retenu est le net
            après remise — c&apos;est lui qui figure au contrat et dans la colonne « adjugé » du
            budget CFC.
          </p>
        ) : (
          <p className="note">
            La proposition est le moins-disant net. Ce n&apos;est{' '}
            <strong>qu&apos;une proposition</strong> : la décision reste humaine, et une offre plus
            chère peut être retenue pour des raisons de références ou de délais.
          </p>
        )}

        <p className="note">
          La notation porte ici sur le <strong>prix seul</strong>. Une notation multicritère
          (références, délais) demanderait des champs que le modèle de données ne porte pas encore —
          c&apos;est une décision à prendre, pas à improviser.
        </p>
      </section>
    </main>
  );
}
