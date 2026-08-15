import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date, lisible, montant } from '../../../../lib/format';
import {
  AjouterFacture,
  ChangerStatut,
  DeposerPdf,
  EnregistrerPaiement,
  ValiderFacture,
} from './saisie';

interface NoeudBudget {
  id: number;
  code: string;
  libelle: string;
  enfants: NoeudBudget[];
}

interface Contrat {
  id: number;
  reference: string | null;
  entreprise: { id: number; nom: string } | null;
}

interface Entreprise {
  id: number;
  nom: string;
}

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

/**
 * Ce qu'il reste à régler sur une facture : TTC moins les paiements déjà
 * enregistrés. C'est une **suggestion** pré-remplie, modifiable — un paiement
 * partiel ou une retenue de garantie est le cas courant, pas l'exception.
 */
function resteADue(f: Facture): string | null {
  if (f.montantTTC === null) return null;
  const paye = f.paiements.reduce((t, p) => t + Number(p.montant), 0);
  const reste = Number(f.montantTTC) - paye;
  return reste > 0 ? reste.toFixed(2) : null;
}

/** Aplatit l'arbre CFC : on ne choisit pas un poste dans un arbre replié. */
function aplatirPostes(noeuds: NoeudBudget[]): { id: number; code: string; libelle: string }[] {
  return noeuds.flatMap((n) => [
    { id: n.id, code: n.code, libelle: n.libelle },
    ...aplatirPostes(n.enfants),
  ]);
}

export default async function FacturesPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'factures';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  // Contrats, entreprises et postes ne servent qu'aux listes déroulantes de
  // saisie ; un refus sur l'un d'eux ne doit pas priver l'écran des factures.
  const [factures, contrats, entreprises, budget] = await Promise.all([
    apiGet<Facture[]>(`/operations/${operationId}/factures`),
    apiGet<Contrat[]>(`/operations/${operationId}/contrats`),
    apiGet<Entreprise[]>('/entreprises'),
    apiGet<{ arbre: NoeudBudget[] }>(`/operations/${operationId}/budget`),
  ]);

  if (factures === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Factures</h2>
          <p>Votre accès à cette promotion ne couvre pas les factures.</p>
        </section>
      </main>
    );
  }

  const aValider = factures.filter((f) => f.statut === 'RECUE' || f.statut === 'A_VALIDER');

  const id = Number(operationId);
  const postes = aplatirPostes(budget?.arbre ?? []);
  const contratsChoisis = (contrats ?? []).map((c) => ({
    id: c.id,
    reference: c.reference,
    entrepriseNom: c.entreprise?.nom ?? '—',
  }));

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Factures"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
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
          <p>Aucune facture sur cette promotion.</p>
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
                  <th>Traitement</th>
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
                      <td>
                        <div className="actions-cellule">
                          {/* Une facture validée n'est plus à relire ni à
                              imputer : seul le règlement reste à faire. */}
                          {f.statut !== 'VALIDEE' && f.statut !== 'PAYEE' && (
                            <>
                              <DeposerPdf operationId={id} factureId={f.id} />
                              <ValiderFacture
                                operationId={id}
                                factureId={f.id}
                                postes={postes}
                                contrats={contratsChoisis}
                              />
                            </>
                          )}
                          {f.statut !== 'PAYEE' && (
                            <ChangerStatut operationId={id} factureId={f.id} />
                          )}
                          {(f.statut === 'VALIDEE' || f.statut === 'PAYEE') && (
                            <EnregistrerPaiement
                              operationId={id}
                              factureId={f.id}
                              suggestion={resteADue(f)}
                            />
                          )}
                        </div>
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

        <AjouterFacture
          operationId={id}
          entreprises={entreprises ?? []}
          contrats={contratsChoisis}
          postes={postes}
        />
      </section>
    </main>
  );
}
