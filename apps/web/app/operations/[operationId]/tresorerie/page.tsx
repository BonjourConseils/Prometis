import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, montant } from '../../../../lib/format';

interface Mois {
  mois: string;
  encaisse: string;
  decaisse: string;
  net: string;
  cumul: string;
  nombreMouvements: number;
}

interface Situation {
  position: string;
  totalEncaisse: string;
  totalDecaisse: string;
  creux: { mois: string; position: string } | null;
  mois: Mois[];
  attendu: {
    creancesAcquereurs: string;
    nombreAppelsOuverts: number;
    detail: { numero: string | null; lot: string; dateEcheance: string | null; solde: string }[];
  };
  engagements: { commandeHt: string; factureHt: string; resteAFacturerHt: string };
}

interface Operation {
  id: number;
  nom: string;
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** « 2026-03 » → « mars 2026 ». */
function moisLisible(cle: string): string {
  const [annee, mois] = cle.split('-');
  const nom = MOIS[Number(mois) - 1];
  return nom ? `${nom} ${annee}` : cle;
}

/**
 * Trésorerie consolidée.
 *
 * Attention à la lecture : cette page additionne des **mouvements de caisse**,
 * pas des postes de budget. Elle ne se compare donc pas à l'écran Écarts, qui
 * raisonne hors taxe. Elle répond à « ai-je de quoi payer la prochaine
 * situation ? », lui à « suis-je dans mon budget ? ».
 */
export default async function TresoreriePage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'tresorerie';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const situation = await apiGet<Situation>(`/operations/${operationId}/tresorerie`);

  if (situation === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Trésorerie</h2>
          <p>
            Le module Trésorerie n&apos;est pas activé sur cette société, ou votre accès à
            l&apos;opération ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  const positionNegative = Number(situation.position) < 0;

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Trésorerie"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <section>
        <p className="note">
          Mouvements réellement passés — encaissements des acquéreurs et règlements aux
          fournisseurs. Ce qui est facturé mais impayé figure sous « attendu », pas dans la
          position.
        </p>
      </section>

      <section>
        <h2>Position</h2>
        <table>
          <tbody>
            <tr>
              <td>Encaissé</td>
              <td className="droite">{chf(situation.totalEncaisse)}</td>
            </tr>
            <tr>
              <td>Décaissé</td>
              <td className="droite">{chf(situation.totalDecaisse)}</td>
            </tr>
            <tr>
              <td>
                <strong>Position</strong>
              </td>
              <td className="droite">
                <strong>{chf(situation.position)}</strong>
                {positionNegative && (
                  <>
                    <br />
                    <span className="meta">financée par le crédit de construction</span>
                  </>
                )}
              </td>
            </tr>
            {situation.creux && (
              <tr>
                <td>Point le plus bas</td>
                <td className="droite">
                  {chf(situation.creux.position)}
                  <br />
                  <span className="meta">{moisLisible(situation.creux.mois)}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Attendu des acquéreurs</h2>
        <p className="note">
          {situation.attendu.nombreAppelsOuverts} appel
          {situation.attendu.nombreAppelsOuverts > 1 ? 's' : ''} de fonds encore ouvert
          {situation.attendu.nombreAppelsOuverts > 1 ? 's' : ''} —{' '}
          <strong>{chf(situation.attendu.creancesAcquereurs)}</strong>.
        </p>
        {situation.attendu.detail.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Appel</th>
                <th>Lot</th>
                <th>Échéance</th>
                <th className="droite">Solde dû</th>
              </tr>
            </thead>
            <tbody>
              {situation.attendu.detail.map((c, i) => (
                <tr key={`${c.numero ?? 'appel'}-${i}`}>
                  <td>{c.numero ?? '—'}</td>
                  <td>{c.lot}</td>
                  <td>{date(c.dateEcheance)}</td>
                  <td className="droite">{montant(c.solde)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Engagements fournisseurs</h2>
        <p className="note">
          Hors taxe, comme les contrats dont ils sortent : ces montants annoncent ce qui reste à
          facturer, ils ne s&apos;additionnent pas aux flux de caisse ci-dessus.
        </p>
        <table>
          <tbody>
            <tr>
              <td>Commandé (contrats + avenants)</td>
              <td className="droite">{chf(situation.engagements.commandeHt)}</td>
            </tr>
            <tr>
              <td>Facturé et validé</td>
              <td className="droite">{chf(situation.engagements.factureHt)}</td>
            </tr>
            <tr>
              <td>
                <strong>Reste à facturer</strong>
              </td>
              <td className="droite">
                <strong>{chf(situation.engagements.resteAFacturerHt)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Mois par mois</h2>
        {situation.mois.length === 0 ? (
          <p>Aucun mouvement enregistré sur cette opération.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Mois</th>
                <th className="droite">Encaissé</th>
                <th className="droite">Décaissé</th>
                <th className="droite">Net</th>
                <th className="droite">Position cumulée</th>
              </tr>
            </thead>
            <tbody>
              {situation.mois.map((m) => (
                <tr key={m.mois}>
                  <td>
                    {moisLisible(m.mois)}
                    {m.nombreMouvements === 0 && (
                      <>
                        {' '}
                        <span className="meta">— aucun mouvement</span>
                      </>
                    )}
                  </td>
                  <td className="droite">{montant(m.encaisse)}</td>
                  <td className="droite">{montant(m.decaisse)}</td>
                  <td className="droite">{montant(m.net)}</td>
                  <td className="droite">
                    <strong>{montant(m.cumul)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
