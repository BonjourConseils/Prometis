import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { chf, lisible, montant, nombre } from '../../../../lib/format';

interface Parking {
  id: number;
  reference: string | null;
  type: string;
  prix: string | null;
}

interface Lot {
  id: number;
  reference: string;
  etage: number | null;
  nombrePieces: string | null;
  surfaceM2: string | null;
  quotePartPPE: string | null;
  prixVente: string | null;
  statut: string;
  parkings: Parking[];
}

interface Bien {
  id: number;
  nom: string;
  lots: Lot[];
}

interface Reservation {
  id: number;
  statut: string;
  prixTotalActe: string | null;
  dateSignatureActe: string | null;
  lot: { id: number; reference: string };
  acquereur: { id: number; nom: string | null; prenom: string | null; email: string | null };
  appelsDeFonds: {
    id: number;
    montant: string;
    statut: string;
    encaissements: { montant: string }[];
  }[];
}

interface Operation {
  id: number;
  nom: string;
}

const somme = (valeurs: (string | null)[]) => valeurs.reduce((t, v) => t + (v ? Number(v) : 0), 0);

export default async function LotsPage({ params }: { params: Promise<{ operationId: string }> }) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [biens, reservations] = await Promise.all([
    apiGet<Bien[]>(`/operations/${operationId}/biens`),
    apiGet<Reservation[]>(`/operations/${operationId}/reservations`),
  ]);

  if (biens === null) {
    return (
      <main>
        <AppHeader me={me} actif="operations" />
        <section>
          <h2>Lots &amp; acquéreurs</h2>
          <p>Votre accès à cette opération ne couvre pas les lots.</p>
        </section>
      </main>
    );
  }

  const parLot = new Map((reservations ?? []).map((r) => [r.lot.id, r]));
  const tousLots = biens.flatMap((b) => b.lots);
  const recettes = tousLots.reduce(
    (t, l) => t + Number(l.prixVente ?? 0) + somme(l.parkings.map((p) => p.prix)),
    0,
  );
  const vendus = tousLots.filter((l) => parLot.has(l.id));

  return (
    <main className="large">
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Lots &amp; acquéreurs
      </div>

      <section>
        <h2>Plan de vente</h2>
        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Lots</span>
            <span className="valeur">{tousLots.length}</span>
            <span className="meta">{vendus.length} avec réservation</span>
          </div>
          <div className="kpi">
            <span className="etiquette">Recettes potentielles</span>
            <span className="valeur">{chf(String(recettes))}</span>
            <span className="meta">lots + places de parc</span>
          </div>
        </div>
      </section>

      {biens.map((bien) => (
        <section key={bien.id}>
          <h2>
            {bien.nom} — {bien.lots.length} lots
          </h2>
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th className="droite">Surface</th>
                  <th className="droite">Quote-part</th>
                  <th className="droite">Prix lot</th>
                  <th>Parkings</th>
                  <th className="droite">Prix total acte</th>
                  <th>Acquéreur</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {bien.lots.map((lot) => {
                  const reservation = parLot.get(lot.id);
                  const prixParkings = somme(lot.parkings.map((p) => p.prix));
                  // Le prix total acte affiché est celui FIGÉ dans la
                  // réservation dès qu'elle existe : c'est lui l'assiette des
                  // appels de fonds, même si le prix du lot a bougé depuis.
                  const prixActe =
                    reservation?.prixTotalActe ?? String(Number(lot.prixVente ?? 0) + prixParkings);

                  return (
                    <tr key={lot.id}>
                      <td>
                        <strong>{lot.reference}</strong>
                        {lot.etage !== null && <span className="meta"> · étage {lot.etage}</span>}
                        {lot.nombrePieces && (
                          <span className="meta"> · {nombre(lot.nombrePieces)} p.</span>
                        )}
                      </td>
                      <td className="droite">{nombre(lot.surfaceM2, 'm²')}</td>
                      <td className="droite">{nombre(lot.quotePartPPE)} ‰</td>
                      <td className="droite">{montant(lot.prixVente)}</td>
                      <td>
                        {lot.parkings.length === 0 ? (
                          <span className="meta">—</span>
                        ) : (
                          lot.parkings.map((p) => (
                            <div key={p.id}>
                              <span className="meta">
                                {lisible(p.type)} {montant(p.prix)}
                              </span>
                            </div>
                          ))
                        )}
                      </td>
                      <td className="droite">
                        <strong>{montant(prixActe)}</strong>
                        {reservation && <span className="badge">figé</span>}
                      </td>
                      <td>
                        {reservation ? (
                          <>
                            {[reservation.acquereur.prenom, reservation.acquereur.nom]
                              .filter(Boolean)
                              .join(' ')}
                            {reservation.appelsDeFonds.length > 0 && (
                              <>
                                <br />
                                <span className="meta">
                                  {reservation.appelsDeFonds.length} appel
                                  {reservation.appelsDeFonds.length > 1 ? 's' : ''} ·{' '}
                                  {montant(
                                    String(somme(reservation.appelsDeFonds.map((a) => a.montant))),
                                  )}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          <span className="meta">—</span>
                        )}
                      </td>
                      <td>{lisible(reservation?.statut ?? lot.statut)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
