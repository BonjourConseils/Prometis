import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../../lib/session';
import { AppHeader, type Me } from '../../../../components/app-header';
import { PageHeader } from '../../../../components/page-header';
import { chf, date, montant, pourcentage } from '../../../../../lib/format';
import { Adjuger, CreerContrat, EnregistrerOffre, InviterEntreprise } from './saisie';
import {
  AjouterPiece,
  Criteres,
  Dossier,
  EnvoyerInvitations,
  JoindrePdf,
  LignesOffre,
  LireOffre,
  Noter,
  Repondre,
  RevoquerAcces,
} from './consultation';

interface Entreprise {
  id: number;
  nom: string;
  corpsMetier: string | null;
}

interface Contrat {
  id: number;
  reference: string | null;
  statut: string;
  adjudication: { id: number; montantAdjuge: string } | null;
}

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
  entrepriseId: number;
  source: 'SAISIE' | 'PORTAIL';
  scellee: boolean;
  note: string | null;
  lignes: {
    id: number;
    type: 'OPTION' | 'VARIANTE';
    libelle: string;
    montant: string;
    retenue: boolean;
  }[];
  documents: { id: number; fileName: string }[];
  notes: { critereId: number; note: string; commentaire: string | null }[];
  score: { total: string | null; manquants: number } | null;
}

interface Invitation {
  id: number;
  entrepriseId: number;
  email: string | null;
  dateEnvoi: string | null;
  consulteeLe: string | null;
  aRepondu: boolean;
  relanceLe: string | null;
  refuseLe: string | null;
  motifRefus: string | null;
  revoqueeLe: string | null;
  lienEnvoye: boolean;
  entreprise: { nom: string; email: string | null };
}

interface Question {
  id: number;
  question: string;
  reponse: string | null;
  reponduLe: string | null;
  publiee: boolean;
  createdAt: string;
  invitation: { entreprise: { nom: string } } | null;
}

interface Piece {
  id: number;
  titre: string;
  fileName: string;
  offreId: number | null;
  visibiliteExterne: boolean;
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
  dossier: {
    descriptif: string | null;
    conditions: string | null;
    delaiExecution: string | null;
    offresScellees: boolean;
    dateEnvoi: string | null;
  };
  criteres: { id: number; libelle: string; poids: string; estPrix: boolean }[];
  invitations: Invitation[];
  adjudicable: boolean;
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
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'soumissions';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, c, entreprises, contrats, questions, pieces] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<Comparaison>(`/operations/${operationId}/soumissions/${soumissionId}/comparaison`),
    apiGet<Entreprise[]>('/entreprises'),
    apiGet<Contrat[]>(`/operations/${operationId}/contrats`),
    apiGet<Question[]>(`/operations/${operationId}/soumissions/${soumissionId}/questions`),
    apiGet<Piece[]>(`/operations/${operationId}/documents?soumissionId=${soumissionId}`),
  ]);

  if (!operation) notFound();
  if (c === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Comparaison des offres</h2>
          <p>Votre accès à cette promotion ne couvre pas les soumissions.</p>
        </section>
      </main>
    );
  }

  const classees = [...c.offres].sort(
    (a, b) => (a.rang ?? Number.MAX_SAFE_INTEGER) - (b.rang ?? Number.MAX_SAFE_INTEGER),
  );

  const id = Number(operationId);
  // Le contrat de cette adjudication, s'il a déjà été généré.
  const contrat =
    c.adjudication === null
      ? null
      : ((contrats ?? []).find((k) => k.adjudication?.id === c.adjudication?.id) ?? null);

  // Seules les offres chiffrées sont adjugeables : l'API refuse les autres,
  // autant ne pas les proposer.
  const adjugeables = classees.filter((o) => o.montantNet !== null && Number(o.montantNet) > 0);
  const sid = Number(soumissionId);
  const envoyee = ['ENVOYEE', 'OUVERTE', 'EN_COMPARAISON'].includes(c.soumission.statut);
  const enConsultation = ['BROUILLON', 'ENVOYEE', 'OUVERTE'].includes(c.soumission.statut);
  const dossierDiffuse = (pieces ?? []).filter((p) => p.offreId === null && p.visibiliteExterne);
  const actives = c.invitations.filter((i) => !i.revoqueeLe && !i.refuseLe);
  const criteresNonPrix = c.criteres.filter((k) => !k.estPrix);
  const avecScore = c.criteres.length > 0;

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Soumissions"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
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
        <h2>Le dossier</h2>
        {c.adjudication ? (
          <p className="note">Soumission adjugée : le dossier est figé.</p>
        ) : (
          <Dossier
            operationId={id}
            soumissionId={sid}
            envoyee={envoyee}
            valeurs={{ ...c.dossier, dateLimite: c.soumission.dateLimite }}
          />
        )}
        <h3>Pièces envoyées aux entreprises</h3>
        {dossierDiffuse.length === 0 ? (
          <p className="meta">Aucune pièce : plans, descriptif détaillé, métrés s’ajoutent ici.</p>
        ) : (
          <ul>
            {dossierDiffuse.map((p) => (
              <li key={p.id}>
                <a
                  href={`/api/prometis/operations/${operationId}/documents/${p.id}/contenu`}
                  download={p.fileName}
                >
                  {p.titre}
                </a>
              </li>
            ))}
          </ul>
        )}
        {!c.adjudication && <AjouterPiece operationId={id} soumissionId={sid} />}
      </section>

      <section>
        <h2>Entreprises consultées</h2>
        {c.invitations.length === 0 ? (
          <p className="meta">Aucune entreprise invitée.</p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Dossier envoyé</th>
                  <th>Consulté</th>
                  <th>Réponse</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {c.invitations.map((i) => (
                  <tr key={i.id} className={i.revoqueeLe || i.refuseLe ? 'attenue' : ''}>
                    <td>
                      <strong>{i.entreprise.nom}</strong>
                      <br />
                      <span className="meta">
                        {i.email ?? i.entreprise.email ?? 'sans adresse e-mail'}
                      </span>
                    </td>
                    <td>{i.lienEnvoye && i.dateEnvoi ? date(i.dateEnvoi) : '—'}</td>
                    <td>{i.consulteeLe ? date(i.consulteeLe) : '—'}</td>
                    <td>
                      {i.revoqueeLe
                        ? 'accès retiré'
                        : i.refuseLe
                          ? `déclinée${i.motifRefus ? ` — ${i.motifRefus}` : ''}`
                          : i.aRepondu
                            ? 'offre reçue'
                            : i.relanceLe
                              ? `relancée le ${date(i.relanceLe)}`
                              : 'attendue'}
                    </td>
                    <td>
                      {enConsultation && !i.refuseLe && i.lienEnvoye && (
                        <EnvoyerInvitations
                          operationId={id}
                          soumissionId={sid}
                          libelle="Renvoyer le lien"
                          entrepriseIds={[i.entrepriseId]}
                          destinataires={[{ nom: i.entreprise.nom, email: i.entreprise.email }]}
                        />
                      )}{' '}
                      {enConsultation && i.lienEnvoye && !i.revoqueeLe && (
                        <RevoquerAcces
                          operationId={id}
                          soumissionId={sid}
                          invitationId={i.id}
                          entreprise={i.entreprise.nom}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {enConsultation && (
          <div className="actions">
            <InviterEntreprise
              operationId={id}
              soumissionId={sid}
              entreprises={entreprises ?? []}
            />
            <EnvoyerInvitations
              operationId={id}
              soumissionId={sid}
              libelle={
                c.invitations.some((i) => i.lienEnvoye)
                  ? 'Envoyer aux entreprises pas encore invitées'
                  : 'Envoyer le dossier'
              }
              entrepriseIds={actives.filter((i) => !i.lienEnvoye).map((i) => i.entrepriseId)}
              destinataires={actives
                .filter((i) => !i.lienEnvoye)
                .map((i) => ({ nom: i.entreprise.nom, email: i.entreprise.email }))}
            />
          </div>
        )}
        <p className="note">
          Trois jours avant la date limite, une entreprise qui n’a ni déposé ni décliné reçoit un
          rappel — une seule fois.
        </p>
      </section>

      {(questions ?? []).length > 0 && (
        <section>
          <h2>Questions des entreprises</h2>
          {(questions ?? []).map((q) => (
            <article key={q.id} className="proposition">
              <header>
                <strong>{q.invitation?.entreprise.nom ?? 'Question interne'}</strong>
                <span className="meta"> · {date(q.createdAt)}</span>
                {q.publiee && <span className="badge">publiée à tous</span>}
              </header>
              <p>{q.question}</p>
              {q.reponse && !enConsultation && <blockquote>{q.reponse}</blockquote>}
              {enConsultation && (
                <Repondre
                  operationId={id}
                  soumissionId={sid}
                  questionId={q.id}
                  reponse={q.reponse}
                />
              )}
            </article>
          ))}
        </section>
      )}

      <section>
        <h2>Critères d’adjudication</h2>
        {c.criteres.length ? (
          <p>{c.criteres.map((k) => `${k.libelle} ${Number(k.poids)} %`).join(' · ')}</p>
        ) : (
          <p className="meta">
            Pas de critères : la comparaison porte sur le prix seul. Des critères pondérés
            (références, délais, qualité technique) donnent un score sur 100 à chaque offre.
          </p>
        )}
        {!c.adjudication && (
          <Criteres
            operationId={id}
            soumissionId={sid}
            criteres={c.criteres.map((k) => ({
              libelle: k.libelle,
              poids: String(Number(k.poids)),
              estPrix: k.estPrix,
            }))}
          />
        )}
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
                {avecScore && <th className="droite">Score / 100</th>}
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
                      {o.scellee && <span className="badge">pli scellé</span>}
                      {o.source === 'PORTAIL' && !o.scellee && (
                        <span className="badge">déposée en ligne</span>
                      )}
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
                    {avecScore && (
                      <td className="droite">
                        {o.score?.total ?? (o.scellee ? '—' : `${o.score?.manquants ?? 0} à noter`)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {classees.some((o) => !o.scellee) && (
          <div className="details-offres">
            {classees
              .filter((o) => !o.scellee)
              .map((o) => (
                <details key={o.id}>
                  <summary>
                    {o.entrepriseNom}
                    {o.lignes.length > 0 &&
                      ` · ${o.lignes.length} option${o.lignes.length > 1 ? 's' : ''}/variante${o.lignes.length > 1 ? 's' : ''}`}
                  </summary>
                  {o.lignes.length > 0 && (
                    <ul>
                      {o.lignes.map((l) => (
                        <li key={l.id}>
                          {l.type === 'OPTION' ? 'Option' : 'Variante'} : {l.libelle} —{' '}
                          {montant(l.montant)}
                          {l.retenue && <span className="badge">retenue</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.note && <p className="meta">{o.note}</p>}
                  {o.notes.length > 0 && (
                    <ul>
                      {o.notes.map((n) => (
                        <li key={n.critereId}>
                          {c.criteres.find((k) => k.id === n.critereId)?.libelle} : {Number(n.note)}
                          /10
                          {n.commentaire ? ` — ${n.commentaire}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>
                    {o.documents.map((d) => (
                      <a
                        key={d.id}
                        href={`/api/prometis/operations/${operationId}/documents/${d.id}/contenu`}
                        download={d.fileName}
                      >
                        {d.fileName}
                      </a>
                    ))}
                    {o.documents.length === 0 && o.source === 'SAISIE' && !c.adjudication && (
                      <JoindrePdf
                        operationId={id}
                        soumissionId={sid}
                        offreId={o.id}
                        entreprise={o.entrepriseNom}
                      />
                    )}
                  </p>
                  {!c.adjudication && (
                    <div className="actions">
                      {o.documents.length > 0 && (
                        <LireOffre
                          operationId={id}
                          soumissionId={sid}
                          offreId={o.id}
                          entrepriseId={o.entrepriseId}
                          saisie={o.source === 'SAISIE'}
                        />
                      )}
                      {o.source === 'SAISIE' && (
                        <LignesOffre
                          operationId={id}
                          soumissionId={sid}
                          offreId={o.id}
                          lignes={o.lignes.map((l) => ({
                            type: l.type,
                            libelle: l.libelle,
                            montant: l.montant,
                          }))}
                        />
                      )}
                      <Noter
                        operationId={id}
                        soumissionId={sid}
                        offreId={o.id}
                        criteres={criteresNonPrix}
                        notes={o.notes}
                      />
                    </div>
                  )}
                </details>
              ))}
          </div>
        )}

        {!c.adjudicable && (
          <p className="note avertissement">
            Des offres sont sous pli scellé jusqu’au {date(c.soumission.dateLimite)} : on sait
            qu’elles sont arrivées, pas ce qu’elles contiennent. Elles s’ouvrent toutes ensemble à
            la date limite ; l’adjudication attend ce moment.
          </p>
        )}

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
      </section>

      <section>
        <h2>Saisir une offre, adjuger</h2>
        <p className="meta">
          Pour une offre reçue hors de l’espace entreprise — par courrier, par e-mail. Une offre
          déposée en ligne par l’entreprise ne se ressaisit pas : ses montants font foi.
        </p>
        {c.adjudication === null ? (
          <>
            <div className="actions">
              <EnregistrerOffre
                operationId={id}
                soumissionId={Number(soumissionId)}
                entreprises={entreprises ?? []}
              />
              {c.adjudicable && adjugeables.length > 0 && (
                <Adjuger
                  operationId={id}
                  soumissionId={Number(soumissionId)}
                  offres={adjugeables}
                />
              )}
            </div>
            {c.adjudicable && adjugeables.length === 0 && (
              <p className="note">
                Aucune offre chiffrée : il n&apos;y a rien à adjuger. Enregistrez au moins un
                montant.
              </p>
            )}
          </>
        ) : contrat === null ? (
          <>
            <p className="note">
              Soumission adjugée. Le contrat d&apos;entreprise reste à générer : c&apos;est lui qui
              porte le montant <strong>commandé</strong> auquel les factures seront confrontées.
            </p>
            <div className="actions">
              <CreerContrat operationId={id} adjudicationId={c.adjudication.id} />
            </div>
          </>
        ) : (
          <p className="note">
            Contrat <strong>{contrat.reference ?? `n° ${contrat.id}`}</strong> généré pour{' '}
            {chf(c.adjudication.montantAdjuge)}. Les factures de cette entreprise s&apos;imputeront
            dessus, avec le contrôle « facturé cumulé ≤ commandé ».
          </p>
        )}
      </section>
    </main>
  );
}
