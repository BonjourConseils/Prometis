import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, lisible, montant, nomAcquereur, pourcentage } from '../../../../lib/format';
import {
  AjouterMandat,
  ChangerStatutCommission,
  ChangerStatutMandat,
  ConstaterCommissions,
} from './saisie';

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

interface Acteur {
  id: number;
  type: string;
  societeNom: string | null;
  nom: string | null;
  prenom: string | null;
}

interface Bien {
  lots: { id: number; reference: string }[];
}

interface Reservation {
  id: number;
  statut: string;
  lot: { reference: string };
  acquereur: { nom: string | null; prenom: string | null; email: string | null };
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

  // Acteurs, biens et réservations n'alimentent que les listes déroulantes.
  const [mandats, commissions, acteurs, biens, reservations] = await Promise.all([
    apiGet<Mandat[]>(`/operations/${operationId}/courtage/mandats`),
    apiGet<Commission[]>(`/operations/${operationId}/courtage/commissions`),
    apiGet<Acteur[]>('/acteurs'),
    apiGet<Bien[]>(`/operations/${operationId}/biens`),
    apiGet<Reservation[]>(`/operations/${operationId}/reservations`),
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

  const id = Number(operationId);
  // Seuls les acteurs de type COURTIER peuvent porter un mandat : proposer
  // l'annuaire entier ferait signer un mandat à un ingénieur civil.
  const courtiers = (acteurs ?? [])
    .filter((a) => a.type === 'COURTIER')
    .map((a) => ({
      id: a.id,
      libelle: (a.societeNom ?? [a.prenom, a.nom].filter(Boolean).join(' ')) || `Acteur ${a.id}`,
    }));
  const lots = (biens ?? []).flatMap((b) => b.lots);
  const ventes = (reservations ?? []).map((r) => ({
    reservationId: r.id,
    libelle: `Lot ${r.lot.reference} — ${nomAcquereur(r.acquereur)} (${lisible(r.statut).toLowerCase()})`,
  }));

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
                  <td>
                    <div className="actions-cellule">
                      {m.statut === 'BROUILLON' && (
                        <ChangerStatutMandat operationId={id} mandatId={m.id} vers="SIGNE" />
                      )}
                      {m.statut === 'SIGNE' && (
                        <ChangerStatutMandat operationId={id} mandatId={m.id} vers="ACTIF" />
                      )}
                      {(m.statut === 'ACTIF' || m.statut === 'SIGNE') && (
                        <>
                          <ChangerStatutMandat operationId={id} mandatId={m.id} vers="TERMINE" />
                          <ChangerStatutMandat operationId={id} mandatId={m.id} vers="RESILIE" />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AjouterMandat operationId={id} courtiers={courtiers} lots={lots} />
        {courtiers.length === 0 && (
          <p className="note">
            Aucun acteur de type <strong>courtier</strong> dans l&apos;annuaire : un mandat ne peut
            pas être signé sans lui.
          </p>
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
                <th>Règlement</th>
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
                  <td>
                    <div className="actions-cellule">
                      {c.statut === 'DUE' && (
                        <>
                          <ChangerStatutCommission
                            operationId={id}
                            commissionId={c.id}
                            vers="FACTUREE"
                          />
                          <ChangerStatutCommission
                            operationId={id}
                            commissionId={c.id}
                            vers="ANNULEE"
                          />
                        </>
                      )}
                      {c.statut === 'FACTUREE' && (
                        <ChangerStatutCommission
                          operationId={id}
                          commissionId={c.id}
                          vers="PAYEE"
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ConstaterCommissions operationId={id} ventes={ventes} />
      </section>
    </main>
  );
}
