import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, lisible, montant, nombre } from '../../../../lib/format';
import { AjouterBien, AjouterLot, AjouterParcelle, AjouterParking } from './saisie';

interface Parcelle {
  id: number;
  numero: string;
  egrid: string | null;
  commune: string | null;
  surfaceM2: string | null;
  affectationZone: string | null;
  registreFoncier: string | null;
}

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
  nature: string;
  nbEtages: number | null;
  description: string | null;
  lots: Lot[];
}

interface Operation {
  id: number;
  nom: string;
}

/** Prix total acte = prix du lot + Σ places de parc (CLAUDE.md §5). */
function prixTotalActe(lot: Lot): number | null {
  if (lot.prixVente === null) return null;
  return lot.parkings.reduce((total, p) => total + Number(p.prix ?? 0), Number(lot.prixVente));
}

/**
 * Saisie du foncier : parcelles, biens, lots et places de parc.
 *
 * C'est la première étape du parcours — sans lots, il n'y a ni recettes au
 * bilan, ni assiette pour les appels de fonds.
 */
export default async function FoncierPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  const ongletActif = 'foncier';
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [parcelles, biens] = await Promise.all([
    apiGet<Parcelle[]>(`/operations/${operationId}/parcelles`),
    apiGet<Bien[]>(`/operations/${operationId}/biens`),
  ]);

  if (parcelles === null || biens === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={id} />
        <PageHeader titre="Foncier" contexte={operation.nom} />
        <section>
          <h2>Accès refusé</h2>
          <p className="note">
            Le module Foncier n&apos;est pas activé sur cette société, ou votre accès à la promotion
            ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  const tousLots = biens.flatMap((b) => b.lots);
  const totalMillemes = tousLots.reduce((t, l) => t + Number(l.quotePartPPE ?? 0), 0);
  const totalRecettes = tousLots.reduce((t, l) => t + (prixTotalActe(l) ?? 0), 0);

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={id} />

      <PageHeader
        titre="Foncier"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operationId}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Foncier
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="etiquette">Parcelles</span>
          <span className="valeur">{parcelles.length}</span>
        </div>
        <div className="kpi">
          <span className="etiquette">Lots</span>
          <span className="valeur">{tousLots.length}</span>
          <span className="precision">dans {biens.length} bien(s)</span>
        </div>
        <div className="kpi">
          <span className="etiquette">Recettes attendues</span>
          <span className="valeur">{chf(totalRecettes)}</span>
          <span className="precision">lots + places de parc</span>
        </div>
        <div className={`kpi ${totalMillemes === 1000 || totalMillemes === 0 ? '' : 'negatif'}`}>
          <span className="etiquette">Millièmes</span>
          <span className="valeur">{nombre(totalMillemes)}</span>
          <span className="precision">
            {/* L'écart se voit ici, pas chez le notaire. */}
            {totalMillemes === 0
              ? 'aucune quote-part saisie'
              : totalMillemes === 1000
                ? 'réparti sur 1000'
                : `écart de ${nombre(1000 - totalMillemes)} sur 1000`}
          </span>
        </div>
      </div>

      <section>
        <h2>Parcelles</h2>
        {parcelles.length === 0 ? (
          <p className="note">
            Aucune parcelle. Elles portent les extraits du registre foncier et les plans cadastraux.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Commune</th>
                <th>E-GRID</th>
                <th>Affectation</th>
                <th className="droite">Surface</th>
              </tr>
            </thead>
            <tbody>
              {parcelles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.numero}</strong>
                  </td>
                  <td>{p.commune ?? '—'}</td>
                  <td>{p.egrid ? <code>{p.egrid}</code> : '—'}</td>
                  <td>{p.affectationZone ?? '—'}</td>
                  <td className="droite">{p.surfaceM2 ? nombre(p.surfaceM2, 'm²') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AjouterParcelle operationId={id} />
      </section>

      {biens.map((bien) => (
        <section key={bien.id}>
          <h2>
            {bien.nom} — {lisible(bien.nature)}
          </h2>
          <p className="note">
            {bien.nbEtages !== null ? `${bien.nbEtages} étages · ` : ''}
            {bien.lots.length} lot(s)
            {bien.description ? ` · ${bien.description}` : ''}
          </p>

          {bien.lots.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Lot</th>
                  <th className="droite">Étage</th>
                  <th className="droite">Pièces</th>
                  <th className="droite">Surface</th>
                  <th className="droite">Millièmes</th>
                  <th className="droite">Prix lot</th>
                  <th>Places de parc</th>
                  <th className="droite">Prix total acte</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {bien.lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <strong>{lot.reference}</strong>
                    </td>
                    <td className="droite">{lot.etage ?? '—'}</td>
                    <td className="droite">{lot.nombrePieces ?? '—'}</td>
                    <td className="droite">{lot.surfaceM2 ? nombre(lot.surfaceM2) : '—'}</td>
                    <td className="droite">{lot.quotePartPPE ?? '—'}</td>
                    <td className="droite">{montant(lot.prixVente)}</td>
                    <td>
                      {lot.parkings.length === 0 ? (
                        <span className="meta">aucune</span>
                      ) : (
                        lot.parkings.map((p) => (
                          <div key={p.id} className="meta">
                            {p.reference ?? lisible(p.type)} · {montant(p.prix)}
                          </div>
                        ))
                      )}
                      <AjouterParking
                        operationId={id}
                        lotId={lot.id}
                        referenceLot={lot.reference}
                      />
                    </td>
                    <td className="droite">
                      <strong>{montant(prixTotalActe(lot))}</strong>
                    </td>
                    <td>
                      <span className="badge">{lisible(lot.statut)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <AjouterLot operationId={id} bienId={bien.id} />
        </section>
      ))}

      <section>
        <h2>{biens.length === 0 ? 'Biens' : 'Ajouter un bien'}</h2>
        {biens.length === 0 && (
          <p className="note">
            Aucun bien. Un bien porte les lots : immeuble, villa, chalet ou lotissement.
          </p>
        )}
        <AjouterBien operationId={id} />
      </section>
    </main>
  );
}
