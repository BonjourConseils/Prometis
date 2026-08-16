import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import {
  AdopterVersion,
  AjouterLigne,
  ArchiverVersion,
  ModifierLigne,
  AjouterPoste,
  AjouterVersion,
  ImporterTrame,
  SupprimerLigne,
  SupprimerVersion,
} from './saisie';
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
  niveau: number;
  propre: Colonnes;
  total: Colonnes;
  resteAEngager: string;
  ecartRevisionInitial: string;
  ecartBudgetFacture: string;
  enfants: Noeud[];
}

interface Version {
  id: number;
  libelle: string;
  statut: string;
  isCourant: boolean;
}

interface VueBudget {
  versions: Version[];
  versionInitiale: Version | null;
  versionCourante: Version | null;
  versionAffichee: Version | null;
  arbre: Noeud[];
  total: Colonnes & {
    reserves: string;
    resteAEngager: string;
    resteADepenser: string;
    ecartRevisionInitial: string;
  };
}

interface LigneBudget {
  id: number;
  cfcNodeId: number;
  designation: string | null;
  montant: string;
  estReserve: boolean;
  cfcNode: { code: string; libelle: string } | null;
}

interface Operation {
  id: number;
  nom: string;
}

/** Aplatit l'arbre en lignes, en gardant la profondeur pour l'indentation. */
function aplatir(noeuds: Noeud[], profondeur = 0): { noeud: Noeud; profondeur: number }[] {
  return noeuds.flatMap((noeud) => [
    { noeud, profondeur },
    ...aplatir(noeud.enfants, profondeur + 1),
  ]);
}

const estZero = (v: string) => Number(v) === 0;

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ operationId: string }>;
  searchParams: Promise<{ versionId?: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'budget';
  const { versionId } = await searchParams;

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const vue = await apiGet<VueBudget>(
    `/operations/${operationId}/budget${versionId ? `?versionId=${versionId}` : ''}`,
  );

  if (vue === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Budget CFC</h2>
          <p>
            Votre accès à cette promotion ne couvre pas le budget, ou le module n&apos;est pas
            activé sur cette société.
          </p>
        </section>
      </main>
    );
  }

  // Combien de lignes porte la version affichée : la suppression doit
  // annoncer ce qu'elle emporte, pas le découvrir après coup.
  const lignesVersion = vue.versionAffichee
    ? ((await apiGet<LigneBudget[]>(
        `/operations/${operationId}/budget/versions/${vue.versionAffichee.id}/lignes`,
      )) ?? [])
    : [];

  const totalLignes = lignesVersion.reduce((t, l) => t + Number(l.montant), 0);

  const lignes = aplatir(vue.arbre);
  const ecart = Number(vue.total.ecartRevisionInitial);

  // Liste plate des postes, pour les listes déroulantes de saisie : on ne
  // choisit pas un poste CFC dans un arbre replié.
  const postes = lignes.map(({ noeud }) => ({
    id: noeud.id,
    code: noeud.code,
    libelle: noeud.libelle,
  }));

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Budget CFC"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Budget CFC
      </div>

      <section>
        <h2>Version de budget</h2>
        {vue.versions.length === 0 ? (
          <p className="note">
            Aucune version de budget. Une version porte les lignes chiffrées ; les révisions se
            créent en copiant la précédente.
          </p>
        ) : (
          <div className="onglets">
            {vue.versions.map((v) => (
              <Link
                key={v.id}
                href={`/operations/${operation.id}/budget?versionId=${v.id}`}
                className={v.id === vue.versionAffichee?.id ? 'onglet actif' : 'onglet'}
              >
                {v.libelle}
                <span className="meta">
                  {v.isCourant ? ' · courante' : ''}
                  {v.statut === 'BROUILLON' ? ' · brouillon' : ''}
                  {v.statut === 'ARCHIVE' ? ' · archivée' : ''}
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="actions">
          <AjouterVersion
            operationId={Number(operationId)}
            versions={vue.versions.map((v) => ({ id: v.id, libelle: v.libelle }))}
          />
          {vue.versionAffichee && !vue.versionAffichee.isCourant && (
            <>
              <AdopterVersion
                operationId={Number(operationId)}
                versionId={vue.versionAffichee.id}
              />
              {/* Un brouillon se supprime, une version validée s'archive :
                  ce qui a servi de référence garde sa trace. */}
              {vue.versionAffichee.statut === 'BROUILLON' ? (
                <SupprimerVersion
                  operationId={Number(operationId)}
                  versionId={vue.versionAffichee.id}
                  libelle={vue.versionAffichee.libelle}
                  nombreLignes={lignesVersion.length}
                />
              ) : (
                <ArchiverVersion
                  operationId={Number(operationId)}
                  versionId={vue.versionAffichee.id}
                />
              )}
            </>
          )}
        </div>
      </section>

      <section>
        <h2>Synthèse</h2>
        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Budget initial</span>
            <span className="valeur">{chf(vue.total.budgeteInitial)}</span>
            <span className="meta">{vue.versionInitiale?.libelle ?? '—'}</span>
          </div>
          <div className={`kpi ${ecart === 0 ? '' : ecart > 0 ? 'negatif' : 'positif'}`}>
            <span className="etiquette">Budget affiché</span>
            <span className="valeur">{chf(vue.total.budgeteRevise)}</span>
            <span className="meta">
              {ecart === 0
                ? 'identique à l’initial'
                : `${ecart > 0 ? '+' : ''}${montant(vue.total.ecartRevisionInitial)} vs initial`}
            </span>
          </div>
          <div className="kpi">
            <span className="etiquette">Adjugé</span>
            <span className="valeur">{chf(vue.total.adjuge)}</span>
            <span className="meta">commandé {montant(vue.total.commande)}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Facturé</span>
            <span className="valeur">{chf(vue.total.facture)}</span>
            <span className="meta">payé {montant(vue.total.paye)}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Reste à engager</span>
            <span className="valeur">{chf(vue.total.resteAEngager)}</span>
            <span className="meta">dont {montant(vue.total.reserves)} de réserves</span>
          </div>
        </div>
        <p className="note">
          Tous les montants sont <strong>hors taxe</strong>, comme les lignes de budget — la TVA est
          portée à part. Comparer un budget HT à une facture TTC afficherait un dépassement de 8,1 %
          qui n&apos;existe pas.
        </p>
      </section>

      <section>
        <h2>Arborescence CFC</h2>
        {lignes.length === 0 ? (
          <ImporterTrame operationId={Number(operationId)} />
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Poste</th>
                  <th className="droite">Initial</th>
                  <th className="droite">Révisé</th>
                  <th className="droite">Adjugé</th>
                  <th className="droite">Facturé</th>
                  <th className="droite">Reste à engager</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(({ noeud, profondeur }) => {
                  const vide = estZero(noeud.total.budgeteRevise) && estZero(noeud.total.adjuge);
                  return (
                    <tr
                      key={noeud.id}
                      className={profondeur === 0 ? 'groupe' : vide ? 'attenue' : ''}
                    >
                      <td style={{ paddingLeft: `${profondeur * 1.25}rem` }}>
                        <code>{noeud.code}</code> {noeud.libelle}
                      </td>
                      <td className="droite">{montant(noeud.total.budgeteInitial)}</td>
                      <td className="droite">{montant(noeud.total.budgeteRevise)}</td>
                      <td className="droite">{montant(noeud.total.adjuge)}</td>
                      <td className="droite">{montant(noeud.total.facture)}</td>
                      <td className="droite">{montant(noeud.resteAEngager)}</td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td>Total promotion</td>
                  <td className="droite">{montant(vue.total.budgeteInitial)}</td>
                  <td className="droite">{montant(vue.total.budgeteRevise)}</td>
                  <td className="droite">{montant(vue.total.adjuge)}</td>
                  <td className="droite">{montant(vue.total.facture)}</td>
                  <td className="droite">{montant(vue.total.resteAEngager)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {lignes.length > 0 && (
          <p className="note">
            Les colonnes adjugé et facturé se remplissent avec les adjudications et les factures.
            Elles sont déjà calculées : la vue est juste dès le premier contrat.
          </p>
        )}

        <div className="actions">
          {lignes.length > 0 && <AjouterPoste operationId={Number(operationId)} noeuds={postes} />}
          {vue.versionAffichee && lignes.length > 0 && (
            <AjouterLigne
              operationId={Number(operationId)}
              versionId={vue.versionAffichee.id}
              noeuds={postes}
            />
          )}
        </div>
      </section>

      {/* L'arborescence ci-dessus montre des TOTAUX par poste. Ce sont les
          lignes qui se saisissent et se corrigent : sans cette liste, une
          erreur de montant n'a aucun endroit où se rattraper. */}
      {vue.versionAffichee && (
        <section>
          <h2>Lignes de {vue.versionAffichee.libelle}</h2>
          {lignesVersion.length === 0 ? (
            <p className="note">
              Aucune ligne dans cette version. Les montants se saisissent poste par poste avec «
              Ajouter une ligne de budget » ci-dessus ; l&apos;arborescence en fait les totaux.
            </p>
          ) : (
            <>
              <p className="note">
                {lignesVersion.length} ligne{lignesVersion.length > 1 ? 's' : ''} · total{' '}
                <strong>{chf(String(totalLignes))}</strong>. Plusieurs lignes peuvent viser le même
                poste : elles s&apos;additionnent.
              </p>
              <div className="tableau-large">
                <table>
                  <thead>
                    <tr>
                      <th>Poste CFC</th>
                      <th>Désignation</th>
                      <th className="droite">Montant HT</th>
                      <th>Nature</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesVersion.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.cfcNode ? (
                            <>
                              <code>{l.cfcNode.code}</code> {l.cfcNode.libelle}
                            </>
                          ) : (
                            <span className="meta">poste supprimé</span>
                          )}
                        </td>
                        <td>{l.designation ?? <span className="meta">—</span>}</td>
                        <td className="droite">
                          <strong>{montant(l.montant)}</strong>
                        </td>
                        <td>
                          {l.estReserve ? (
                            <span className="badge">réserve</span>
                          ) : (
                            <span className="meta">travaux</span>
                          )}
                        </td>
                        <td>
                          <div className="actions-cellule">
                            <ModifierLigne
                              operationId={Number(operationId)}
                              ligne={l}
                              noeuds={postes}
                            />
                            <SupprimerLigne operationId={Number(operationId)} ligneId={l.id} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
