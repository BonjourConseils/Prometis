import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, montant } from '../../../../lib/format';
import { Rattacher } from '../../saisie';

interface Photo {
  promotion: {
    id: number;
    nom: string;
    statut: string | null;
    localisation: string | null;
    promoteur: string | null;
  };
  operation: { id: number; nom: string } | null;
  lots: {
    id: number;
    reference: string;
    immeubleNom: string;
    etage: number | null;
    nombrePieces: number | null;
    surfaceM2: number | null;
    prixVente: number | null;
    parkings: { reference: string | null; type: string; prix: number | null }[];
    prixTotalActe: number | null;
    statut: string;
  }[];
  echeancier: {
    totalPourcentage: number;
    complet: boolean;
    etapes: {
      id: number;
      ordre: number;
      libelle: string;
      pourcentage: number;
      statut: string;
      dateCompletion: string | null;
    }[];
  };
  reservations: {
    id: number;
    statut: string;
    lot: string | null;
    clientReference: string | null;
    agence: string | null;
  }[];
}

interface OperationListe {
  id: number;
  nom: string;
  kolabimoPromotionId: number | null;
}

const STATUT_ETAPE: Record<string, string> = {
  NOT_STARTED: 'à venir',
  IN_PROGRESS: 'en cours',
  COMPLETED: 'terminée',
};

/**
 * Ce que Kolabimo sait d'une promotion — lu, pas copié.
 *
 * L'écran sert à décider du rattachement : on voit ce qui entrera dans
 * Prometis avant qu'il y entre. Les prix sont ceux de Kolabimo, qui en est
 * maître ; le prix total acte est déjà calculé par lui (lot + parkings).
 */
export default async function PromotionKolabimoPage({
  params,
}: {
  params: Promise<{ promotionId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { promotionId } = await params;
  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [photo, operations] = await Promise.all([
    apiGet<Photo>(`/passerelle/kolabimo/promotions/${promotionId}`),
    apiGet<OperationListe[]>('/operations'),
  ]);

  if (!photo) {
    return (
      <main>
        <AppHeader me={me} actif="passerelle" />
        <section>
          <h2>Promotion Kolabimo {promotionId}</h2>
          <p className="ko">
            Kolabimo n&apos;a pas rendu cette promotion : elle n&apos;existe pas, ou elle est hors
            du périmètre de votre clé. <Link href="/passerelle/kolabimo">Revenir à la liste</Link>.
          </p>
        </section>
      </main>
    );
  }

  const peutRattacher = ['OWNER', 'ADMIN'].includes(me.workspace?.role ?? '');
  const totalActe = photo.lots.reduce((t, l) => t + (l.prixTotalActe ?? 0), 0);
  const vendus = photo.lots.filter((l) => l.statut !== 'DISPONIBLE').length;

  return (
    <main className="large">
      <AppHeader me={me} actif="passerelle" />
      <PageHeader
        titre={photo.promotion.nom}
        contexte={<Link href="/passerelle/kolabimo">Promotions Kolabimo</Link>}
      />

      <section>
        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Lots</span>
            <span className="valeur">{photo.lots.length}</span>
            <span className="meta">{vendus} engagé(s) ou vendu(s)</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Total des prix d&apos;acte</span>
            <span className="valeur">{chf(String(totalActe))}</span>
            <span className="meta">lots et parkings, selon Kolabimo</span>
          </div>
          <div className={`kpi ${photo.echeancier.complet ? 'positif' : 'negatif'}`}>
            <span className="etiquette">Échéancier</span>
            <span className="valeur">{photo.echeancier.totalPourcentage} %</span>
            <span className="meta">
              {photo.echeancier.complet ? 'couvre tout le prix' : 'ne couvre pas 100 % du prix'}
            </span>
          </div>
          <div className="kpi">
            <span className="etiquette">Réservations</span>
            <span className="valeur">{photo.reservations.length}</span>
            <span className="meta">sans identité avant les fonds versés</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Dans Prometis</h2>
        {photo.operation ? (
          <p>
            Rattachée à{' '}
            <Link href={`/operations/${photo.operation.id}`}>{photo.operation.nom}</Link>. Les
            webhooks tiennent le fil de l&apos;eau ; resynchroniser rattrape ce qui aurait été
            manqué — Kolabimo ne réessaie pas un envoi échoué.
          </p>
        ) : (
          <p className="note">
            Non rattachée. Rattacher importe les lots, leurs parkings et l&apos;échéancier, puis les
            réservations. <strong>Aucun appel de fonds n&apos;est émis</strong> : une étape déjà
            terminée chez Kolabimo arrive terminée, et le premier appel d&apos;un lot vendu en cours
            de chantier se décide à la main.
          </p>
        )}
        {peutRattacher ? (
          <Rattacher
            promotionId={photo.promotion.id}
            promotionNom={photo.promotion.nom}
            // Une opération déjà reliée à une autre promotion n'est pas proposée :
            // deux promotions sur une opération mêleraient deux échéanciers.
            operations={(operations ?? [])
              .filter((o) => o.kolabimoPromotionId === null)
              .map((o) => ({ id: o.id, nom: o.nom }))}
            dejaLiee={photo.operation}
          />
        ) : (
          <p className="meta">Le rattachement est réservé au titulaire et aux administrateurs.</p>
        )}
      </section>

      <section>
        <h2>Lots</h2>
        <div className="tableau-large">
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Immeuble</th>
                <th className="droite">Pièces</th>
                <th className="droite">Surface</th>
                <th className="droite">Prix du lot</th>
                <th>Parkings</th>
                <th className="droite">Prix total acte</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {photo.lots.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.reference}</strong>
                    {l.etage !== null && <span className="meta"> · étage {l.etage}</span>}
                  </td>
                  <td>{l.immeubleNom}</td>
                  <td className="droite">{l.nombrePieces ?? '—'}</td>
                  <td className="droite">{l.surfaceM2 !== null ? `${l.surfaceM2} m²` : '—'}</td>
                  <td className="droite">
                    {l.prixVente !== null ? montant(String(l.prixVente)) : '—'}
                  </td>
                  <td>
                    {l.parkings.length === 0
                      ? '—'
                      : l.parkings.map((p) => (
                          <div key={`${p.reference}-${p.type}`}>
                            {p.type.toLowerCase()} {p.prix !== null ? montant(String(p.prix)) : ''}
                          </div>
                        ))}
                  </td>
                  <td className="droite">
                    <strong>
                      {l.prixTotalActe !== null ? montant(String(l.prixTotalActe)) : '—'}
                    </strong>
                  </td>
                  <td>{l.statut.toLowerCase().replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Échéancier</h2>
        <p className="note">
          Kolabimo en est maître : la fin d&apos;une étape s&apos;y marque, et Prometis en tire les
          appels de fonds.
        </p>
        <table>
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Étape</th>
              <th className="droite">%</th>
              <th>Avancement</th>
            </tr>
          </thead>
          <tbody>
            {photo.echeancier.etapes.map((e) => (
              <tr key={e.id}>
                <td>{e.ordre}</td>
                <td>{e.libelle}</td>
                <td className="droite">
                  {e.pourcentage === 0 ? <span className="meta">suivi</span> : `${e.pourcentage} %`}
                </td>
                <td className={e.statut === 'COMPLETED' ? 'ok' : ''}>
                  {STATUT_ETAPE[e.statut] ?? e.statut.toLowerCase()}
                  {e.dateCompletion && <span className="meta"> · {date(e.dateCompletion)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Réservations</h2>
        <p className="note">
          L&apos;API de Kolabimo ne donne jamais l&apos;identité d&apos;un acquéreur, seulement la
          référence du dossier. Les noms arrivent par webhook, au palier <code>FONDS_VERSES</code> —
          et c&apos;est voulu : Prometis ne doit pas montrer au promoteur ce que Kolabimo lui cache
          encore.
        </p>
        {photo.reservations.length === 0 ? (
          <p>Aucune réservation.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Dossier</th>
                <th>Agence</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {photo.reservations.map((r) => (
                <tr key={r.id}>
                  <td>{r.lot ?? '—'}</td>
                  <td>{r.clientReference ?? <span className="meta">sans référence</span>}</td>
                  <td>{r.agence ?? <span className="meta">vente directe</span>}</td>
                  <td>{r.statut.toLowerCase().replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
