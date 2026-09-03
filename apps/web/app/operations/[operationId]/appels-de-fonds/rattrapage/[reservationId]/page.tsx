import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../../../lib/session';
import { AppHeader, type Me } from '../../../../../components/app-header';
import { PageHeader } from '../../../../../components/page-header';
import { chf, date, montant, pourcentage } from '../../../../../../lib/format';
import { ChoisirEtapes } from './saisie';

interface Vue {
  reservation: {
    id: number;
    statut: string;
    lot: string;
    prixTotalActe: string | null;
    dateSignatureActe: string | null;
    acquereurs: { nom: string; role: string; quotePart: string | null }[];
  };
  etapes: {
    etapeId: number;
    ordre: number;
    libelle: string;
    pourcentage: string;
    dateCompletion: string | null;
    dejaAppelee: boolean;
    montant: string | null;
  }[];
  montantAChoisir: string;
  enAttente: number;
}

interface Operation {
  id: number;
  nom: string;
}

/**
 * Le premier appel d'un lot vendu en cours de chantier.
 *
 * Le cas : la dalle est coulée, le gros œuvre est fini, et l'acquéreur
 * arrive. Trois jalons sont derrière lui.
 *
 * **Rien n'est appelé d'office**, et c'est tout le sujet de cet écran.
 * Certaines de ces tranches figurent dans l'acte et ont été réglées à la
 * signature, chez le notaire ; d'autres ont été négociées, ou reportées.
 * Les appeler automatiquement reviendrait à réclamer à un acquéreur ce
 * qu'il vient de payer — la faute qu'on n'a pas le droit de commettre une
 * fois, parce qu'elle se lit dans sa boîte aux lettres.
 *
 * Le promoteur coche donc, ligne par ligne, et voit le total bouger.
 */
export default async function RattrapagePage({
  params,
}: {
  params: Promise<{ operationId: string; reservationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId, reservationId } = await params;
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, vue] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<Vue>(`/operations/${operationId}/reservations/${reservationId}/rattrapage`),
  ]);

  if (!operation) notFound();
  if (vue === null) {
    return (
      <main>
        <AppHeader me={me} actif="appels" operationId={id} />
        <section>
          <h2>Premier appel</h2>
          <p>Votre accès à cette promotion ne couvre pas les appels de fonds.</p>
        </section>
      </main>
    );
  }

  const aChoisir = vue.etapes.filter((e) => !e.dejaAppelee);
  const deja = vue.etapes.filter((e) => e.dejaAppelee);

  return (
    <main>
      <AppHeader me={me} actif="appels" operationId={id} />

      <PageHeader
        titre={`Premier appel — lot ${vue.reservation.lot}`}
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}/appels-de-fonds`}>Appels de fonds</Link>{' '}
        <span aria-hidden="true">›</span> Lot {vue.reservation.lot}
      </div>

      <section>
        <h2>Le dossier</h2>
        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Lot</span>
            <span className="valeur">{vue.reservation.lot}</span>
            <span className="meta">{vue.reservation.statut.toLowerCase().replace('_', ' ')}</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Prix total acte</span>
            <span className="valeur">
              {vue.reservation.prixTotalActe ? chf(vue.reservation.prixTotalActe) : '—'}
            </span>
            <span className="meta">
              {vue.reservation.dateSignatureActe
                ? `acte signé le ${date(vue.reservation.dateSignatureActe)}`
                : 'acte non signé'}
            </span>
          </div>
          <div className="kpi">
            <span className="etiquette">Jalons en attente</span>
            <span className="valeur">{vue.enAttente}</span>
            <span className="meta">{montant(vue.montantAChoisir)} à trancher</span>
          </div>
        </div>

        {vue.reservation.acquereurs.length === 0 ? (
          <p className="note avertissement">
            Ce dossier n&apos;a <strong>pas encore d&apos;acquéreur nominatif</strong>. Kolabimo ne
            livre l&apos;identité qu&apos;au palier <code>FONDS_VERSES</code> : l&apos;appel peut
            être créé, mais il ne pourra pas être envoyé — il n&apos;aurait aucun destinataire.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Acquéreur</th>
                <th>Rôle</th>
                <th className="droite">Quote-part</th>
              </tr>
            </thead>
            <tbody>
              {vue.reservation.acquereurs.map((a, i) => (
                <tr key={i}>
                  <td>{a.nom}</td>
                  <td>{a.role.toLowerCase().replace('_', ' ')}</td>
                  <td className="droite">{a.quotePart ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {vue.reservation.acquereurs.length > 1 && (
          <p className="note">
            La quote-part figure à l&apos;acte, mais <strong>ne divise pas la créance</strong> : les
            appels de fonds sont solidaires. Chaque acquéreur reçoit la totalité du montant, et un
            seul versement le solde.
          </p>
        )}
      </section>

      <section>
        <h2>Étapes à inclure</h2>
        {aChoisir.length === 0 ? (
          <p className="ok">
            Rien à rattraper : toutes les étapes closes ont déjà donné lieu à un appel sur ce lot.
          </p>
        ) : (
          <>
            <p className="note">
              Ces jalons étaient <strong>déjà terminés</strong> quand le lot a été vendu. Cochez
              ceux qui restent dus. Ne cochez pas ceux qui figurent dans l&apos;acte et ont été
              réglés à la signature — les appeler reviendrait à réclamer deux fois.
            </p>
            <ChoisirEtapes
              operationId={id}
              reservationId={Number(reservationId)}
              etapes={aChoisir.map((e) => ({
                etapeId: e.etapeId,
                libelle: `${e.ordre}. ${e.libelle}`,
                pourcentage: pourcentage(e.pourcentage),
                dateCompletion: e.dateCompletion ? date(e.dateCompletion) : null,
                montant: e.montant,
              }))}
            />
          </>
        )}

        {deja.length > 0 && (
          <>
            <h3>Déjà appelées</h3>
            <table>
              <thead>
                <tr>
                  <th>Jalon</th>
                  <th className="droite">%</th>
                  <th className="droite">Montant</th>
                </tr>
              </thead>
              <tbody>
                {deja.map((e) => (
                  <tr key={e.etapeId} className="attenue">
                    <td>
                      {e.ordre}. {e.libelle}
                    </td>
                    <td className="droite">{pourcentage(e.pourcentage)}</td>
                    <td className="droite">{e.montant ? montant(e.montant) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
