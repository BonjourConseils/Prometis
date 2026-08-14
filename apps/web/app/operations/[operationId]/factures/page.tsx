import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { date, lisible, montant } from '../../../../lib/format';

interface Facture {
  id: number;
  numero: string | null;
  type: string;
  statut: string;
  dateFacture: string | null;
  montantHT: string | null;
  tvaPct: string | null;
  montantTTC: string | null;
  cfcNodeId: number | null;
  cfcSuggereId: number | null;
  ocrStatut: string;
  ocrConfiance: string | null;
  entreprise: { id: number; nom: string } | null;
  cfcNode: { id: number; code: string; libelle: string } | null;
  contrat: { id: number; reference: string | null } | null;
  paiements: { id: number; montant: string; dateValeur: string }[];
}

interface Operation {
  id: number;
  nom: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  RECUE: 'reçue',
  EN_LECTURE: 'en lecture',
  A_VALIDER: 'à valider',
  VALIDEE: 'validée',
  PAYEE: 'payée',
  LITIGE: 'en litige',
  REJETEE: 'rejetée',
};

const CLASSE_STATUT: Record<string, string> = {
  VALIDEE: 'ok',
  PAYEE: 'ok',
  LITIGE: 'ko',
  REJETEE: 'ko',
};

export default async function FacturesPage({
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

  const factures = await apiGet<Facture[]>(`/operations/${operationId}/factures`);

  if (factures === null) {
    return (
      <main>
        <AppHeader me={me} actif="operations" />
        <section>
          <h2>Factures</h2>
          <p>Votre accès à cette opération ne couvre pas les factures.</p>
        </section>
      </main>
    );
  }

  const aValider = factures.filter((f) => f.statut === 'RECUE' || f.statut === 'A_VALIDER');

  return (
    <main className="large">
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Factures
      </div>

      <section>
        <h2>Factures fournisseurs</h2>
        <p className="note">
          {factures.length} facture{factures.length > 1 ? 's' : ''}
          {aValider.length > 0 && <> · {aValider.length} en attente de validation</>}
        </p>

        {factures.length === 0 ? (
          <p>Aucune facture sur cette opération.</p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Facture</th>
                  <th>Fournisseur</th>
                  <th>Imputation CFC</th>
                  <th className="droite">HT</th>
                  <th className="droite">TTC</th>
                  <th className="droite">Payé</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {factures.map((f) => {
                  const paye = f.paiements.reduce((t, p) => t + Number(p.montant), 0);
                  return (
                    <tr key={f.id}>
                      <td>
                        <strong>{f.numero ?? `#${f.id}`}</strong>
                        <br />
                        <span className="meta">
                          {date(f.dateFacture)} · {lisible(f.type)}
                          {f.contrat && ` · ${f.contrat.reference ?? `contrat ${f.contrat.id}`}`}
                        </span>
                      </td>
                      <td>{f.entreprise?.nom ?? <span className="meta">—</span>}</td>
                      <td>
                        {f.cfcNode ? (
                          <>
                            <code>{f.cfcNode.code}</code> {f.cfcNode.libelle}
                          </>
                        ) : f.cfcSuggereId ? (
                          // La proposition ne vaut pas imputation : elle est
                          // affichée comme telle, avec sa confiance.
                          <span className="meta">
                            proposé, à valider
                            {f.ocrConfiance && ` · confiance ${Number(f.ocrConfiance)} %`}
                          </span>
                        ) : f.ocrStatut === 'EN_ATTENTE' ? (
                          // Distinguer « pas encore lue » de « lue sans
                          // proposition » : ce n'est pas le même travail à faire.
                          <span className="meta">en attente de lecture</span>
                        ) : (
                          <span className="meta">à imputer à la main</span>
                        )}
                      </td>
                      <td className="droite">{montant(f.montantHT)}</td>
                      <td className="droite">{montant(f.montantTTC)}</td>
                      <td className="droite">{paye > 0 ? montant(String(paye)) : '—'}</td>
                      <td className={CLASSE_STATUT[f.statut] ?? ''}>
                        {LIBELLE_STATUT[f.statut] ?? lisible(f.statut)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="note">
          Seules les factures <strong>validées</strong> entrent dans la colonne « facturé » du fil
          rouge. Une imputation proposée par la lecture automatique reste une proposition tant
          qu&apos;un humain ne l&apos;a pas confirmée.
        </p>
      </section>
    </main>
  );
}
