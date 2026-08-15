import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../../lib/session';
import { AppHeader, type Me } from '../../../../components/app-header';
import { PageHeader } from '../../../../components/page-header';
import { date, lisible } from '../../../../../lib/format';
import {
  AjouterParticipant,
  AjouterPoint,
  ChangerStatutPoint,
  ChangerStatutSeance,
  GenererPv,
  RetirerParticipant,
} from '../saisie';

interface Participant {
  id: number;
  nom: string | null;
  organisation: string | null;
  email: string | null;
  present: boolean;
}

interface Point {
  id: number;
  ordre: number;
  titre: string;
  contenu: string | null;
  responsable: string | null;
  echeance: string | null;
  statut: string;
  enRetard: boolean;
}

interface DocumentSeance {
  id: number;
  titre: string;
  categorie: string;
  fileName: string;
  createdAt: string;
}

interface Seance {
  id: number;
  titre: string;
  numero: string | null;
  type: string;
  statut: string;
  date: string | null;
  lieu: string | null;
  ordreDuJour: string | null;
  participants: Participant[];
  points: Point[];
  documents: DocumentSeance[];
}

interface Operation {
  id: number;
  nom: string;
}

/**
 * Une séance : présences, points, PV.
 *
 * C'est l'écran où se tient la réunion. Les points s'y ajoutent au fil de la
 * discussion, et le PV se génère à la fin depuis ce qui a été saisi — pas
 * l'inverse.
 */
export default async function SeancePage({
  params,
}: {
  params: Promise<{ operationId: string; seanceId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId, seanceId } = await params;
  const ongletActif = 'seances';
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, seance] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<Seance>(`/operations/${operationId}/seances/${seanceId}`),
  ]);

  if (!operation) notFound();
  if (seance === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={id} />
        <section>
          <h2>Séance</h2>
          <p>Votre accès à cette promotion ne couvre pas les séances.</p>
        </section>
      </main>
    );
  }

  const presents = seance.participants.filter((p) => p.present).length;
  const ouverts = seance.points.filter((p) => p.statut !== 'CLOS');
  const ordreSuivant = seance.points.reduce((max, p) => Math.max(max, p.ordre), 0) + 1;

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={id} />

      <PageHeader
        titre={seance.titre}
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}/seances`}>Séances &amp; PV</Link>{' '}
        <span aria-hidden="true">›</span> {seance.numero ? `n° ${seance.numero}` : seance.titre}
      </div>

      <section>
        <p className="note">
          {lisible(seance.type)} · {date(seance.date)}
          {seance.lieu && ` · ${seance.lieu}`} · {lisible(seance.statut).toLowerCase()} · {presents}{' '}
          présent{presents > 1 ? 's' : ''} sur {seance.participants.length}
        </p>
        {seance.ordreDuJour && (
          <p>
            <strong>Ordre du jour</strong> — {seance.ordreDuJour}
          </p>
        )}
        <div className="actions">
          {seance.statut !== 'TENUE' && (
            <ChangerStatutSeance operationId={id} seanceId={seance.id} vers="TENUE" />
          )}
          {seance.statut !== 'ANNULEE' && (
            <ChangerStatutSeance operationId={id} seanceId={seance.id} vers="ANNULEE" />
          )}
          <GenererPv operationId={id} seanceId={seance.id} />
        </div>
      </section>

      <section>
        <h2>Présences</h2>
        {seance.participants.length === 0 ? (
          <p className="note">Aucun participant inscrit.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Organisation</th>
                <th>E-mail</th>
                <th>Présence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {seance.participants.map((p) => (
                <tr key={p.id} className={p.present ? '' : 'attenue'}>
                  <td>
                    <strong>{p.nom ?? '—'}</strong>
                  </td>
                  <td>{p.organisation ?? <span className="meta">—</span>}</td>
                  <td>{p.email ?? <span className="meta">—</span>}</td>
                  <td>{p.present ? 'présent' : <span className="meta">excusé</span>}</td>
                  <td>
                    <RetirerParticipant
                      operationId={id}
                      seanceId={seance.id}
                      participantId={p.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AjouterParticipant operationId={id} seanceId={seance.id} />
      </section>

      <section>
        <h2>Points</h2>
        <p className="note">
          {seance.points.length} point{seance.points.length > 1 ? 's' : ''} · {ouverts.length}{' '}
          ouvert{ouverts.length > 1 ? 's' : ''}. Un point avec responsable et échéance devient une{' '}
          <strong>action suivie</strong> : il remonte dans les actions ouvertes de la promotion et
          passe en retard tout seul.
        </p>
        {seance.points.length > 0 && (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Point</th>
                  <th>Responsable</th>
                  <th>Échéance</th>
                  <th>Statut</th>
                  <th>Suivi</th>
                </tr>
              </thead>
              <tbody>
                {seance.points.map((p) => (
                  <tr key={p.id} className={p.enRetard ? 'depassement' : ''}>
                    <td>{p.ordre}</td>
                    <td>
                      <strong>{p.titre}</strong>
                      {p.contenu && (
                        <>
                          <br />
                          <span className="meta">{p.contenu}</span>
                        </>
                      )}
                    </td>
                    <td>{p.responsable ?? <span className="meta">—</span>}</td>
                    <td className={p.enRetard ? 'ko' : ''}>
                      {p.echeance ? date(p.echeance) : <span className="meta">—</span>}
                    </td>
                    <td>{lisible(p.statut).toLowerCase()}</td>
                    <td>
                      <div className="actions-cellule">
                        {p.statut !== 'CLOS' ? (
                          <>
                            {p.statut !== 'EN_COURS' && (
                              <ChangerStatutPoint
                                operationId={id}
                                seanceId={seance.id}
                                pointId={p.id}
                                vers="EN_COURS"
                              />
                            )}
                            <ChangerStatutPoint
                              operationId={id}
                              seanceId={seance.id}
                              pointId={p.id}
                              vers="CLOS"
                            />
                          </>
                        ) : (
                          <ChangerStatutPoint
                            operationId={id}
                            seanceId={seance.id}
                            pointId={p.id}
                            vers="OUVERT"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AjouterPoint operationId={id} seanceId={seance.id} ordreSuivant={ordreSuivant} />
      </section>

      {seance.documents.length > 0 && (
        <section>
          <h2>Pièces de la séance</h2>
          <table>
            <thead>
              <tr>
                <th>Titre</th>
                <th>Catégorie</th>
                <th>Fichier</th>
                <th>Déposé le</th>
              </tr>
            </thead>
            <tbody>
              {seance.documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.titre}</strong>
                  </td>
                  <td>{lisible(d.categorie)}</td>
                  <td>{d.fileName}</td>
                  <td>{date(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
