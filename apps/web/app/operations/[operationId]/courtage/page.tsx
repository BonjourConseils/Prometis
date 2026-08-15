import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, lisible, montant, pourcentage } from '../../../../lib/format';

interface Mandat {
  id: number;
  commissionType: string;
  commissionPct: string | null;
  commissionForfait: string | null;
  assietteTtc: boolean;
  perimetre: string;
  exclusif: boolean;
  statut: string;
  dateSignature: string | null;
  courtier: { societeNom: string | null; nom: string | null; prenom: string | null };
  lots: { lot: { id: number; reference: string } }[];
  totaux: { due: string; facturee: string; payee: string; annulee: string };
}

interface Commission {
  id: number;
  montant: string;
  statut: string;
  dateDue: string | null;
  note: string | null;
  mandatCourtage: {
    id: number;
    courtier: { societeNom: string | null; nom: string | null; prenom: string | null };
  };
  reservation: {
    id: number;
    lot: { reference: string };
    acquereur: { nom: string | null; prenom: string | null };
  };
}

interface Operation {
  id: number;
  nom: string;
}

function nomCourtier(c: { societeNom: string | null; nom: string | null; prenom: string | null }) {
  return c.societeNom ?? [c.prenom, c.nom].filter(Boolean).join(' ') ?? '—';
}

/**
 * Mandats de courtage et commissions.
 *
 * L'**assiette** est affichée en toutes lettres à côté du taux : « 3 % du prix
 * TTC » et « 3 % du prix HT » ne donnent pas le même chèque, et c'est
 * exactement le genre d'écart qu'un courtier remarque avant le promoteur.
 */
export default async function CourtagePage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'courtage';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [mandats, commissions] = await Promise.all([
    apiGet<Mandat[]>(`/operations/${operationId}/courtage/mandats`),
    apiGet<Commission[]>(`/operations/${operationId}/courtage/commissions`),
  ]);

  if (mandats === null || commissions === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Courtage</h2>
          <p>
            Le module Courtage n&apos;est pas activé sur cette société, ou votre accès à
            l&apos;promotion ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  const totalDu = commissions
    .filter((c) => c.statut === 'DUE')
    .reduce((total, c) => total + Number(c.montant), 0);

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Courtage"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <section>
        <p className="note">
          {mandats.length} mandat{mandats.length > 1 ? 's' : ''} · {commissions.length} commission
          {commissions.length > 1 ? 's' : ''} constatée{commissions.length > 1 ? 's' : ''} ·{' '}
          <strong>{chf(totalDu)}</strong> encore dus.
        </p>
      </section>

      <section>
        <h2>Mandats</h2>
        {mandats.length === 0 ? (
          <p>Aucun mandat de courtage.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Courtier</th>
                <th>Rémunération</th>
                <th>Périmètre</th>
                <th>Signé le</th>
                <th>État</th>
                <th className="droite">Dû</th>
                <th className="droite">Payé</th>
              </tr>
            </thead>
            <tbody>
              {mandats.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{nomCourtier(m.courtier)}</strong>
                    {m.exclusif && (
                      <>
                        <br />
                        <span className="meta">exclusif</span>
                      </>
                    )}
                  </td>
                  <td>
                    {m.commissionType === 'FORFAIT' ? (
                      <>
                        forfait de {chf(m.commissionForfait)}
                        <br />
                        <span className="meta">indépendant du prix de vente</span>
                      </>
                    ) : (
                      <>
                        {pourcentage(m.commissionPct)}
                        <br />
                        <span className="meta">
                          du prix total acte {m.assietteTtc ? 'TTC' : 'hors taxe'}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {m.perimetre === 'TOUTE_OPERATION' ? (
                      'toute la promotion'
                    ) : (
                      <>
                        {m.lots.length} lot{m.lots.length > 1 ? 's' : ''}
                        <br />
                        <span className="meta">
                          {m.lots.map((l) => l.lot.reference).join(', ')}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{date(m.dateSignature)}</td>
                  <td>{lisible(m.statut)}</td>
                  <td className="droite">{montant(m.totaux.due)}</td>
                  <td className="droite">{montant(m.totaux.payee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Commissions</h2>
        {commissions.length === 0 ? (
          <p>Aucune commission constatée. Elles naissent à la vente d&apos;un lot couvert.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Acquéreur</th>
                <th>Courtier</th>
                <th>Base de calcul</th>
                <th>Échéance</th>
                <th>État</th>
                <th className="droite">Montant</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.reservation.lot.reference}</strong>
                  </td>
                  <td>
                    {[c.reservation.acquereur.prenom, c.reservation.acquereur.nom]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </td>
                  <td>{nomCourtier(c.mandatCourtage.courtier)}</td>
                  <td>
                    <span className="meta">{c.note ?? '—'}</span>
                  </td>
                  <td>{date(c.dateDue)}</td>
                  <td>{lisible(c.statut)}</td>
                  <td className="droite">{montant(c.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
