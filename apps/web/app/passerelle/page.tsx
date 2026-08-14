import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';

interface EtatPasserelle {
  sortant: { configure: boolean; baseUrl: string | null };
  clesEntrantes: { id: number; label: string | null; lastUsedAt: string | null }[];
  compteurs: { source: string; statut: string; nombre: number }[];
}

interface EvenementJournal {
  id: number;
  source: string;
  evenement: string;
  dedupeKey: string;
  statut: string;
  erreur: string | null;
  receivedAt: string;
  processedAt: string | null;
  payload: {
    donnees?: unknown;
    traitement?: Record<string, unknown>;
  } | null;
}

const LIBELLE_STATUT: Record<string, string> = {
  RECU: 'en attente',
  TRAITE: 'traité',
  IGNORE: 'hors périmètre',
  ERREUR: 'en erreur',
};

function dateCourte(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Journal de synchronisation Kolabimo.
 *
 * L'écran répond à une seule question, celle qu'on se pose quand une donnée
 * manque : « qu'est-ce qui est passé, qu'est-ce qui ne l'est pas, et
 * pourquoi ? ». D'où le motif du refus affiché en toutes lettres plutôt qu'un
 * code de statut : un événement en erreur sans raison lisible n'aide personne.
 */
export default async function PasserellePage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [etat, journal] = await Promise.all([
    apiGet<EtatPasserelle>('/passerelle/etat'),
    apiGet<EvenementJournal[]>('/passerelle/journal?limite=100'),
  ]);

  if (etat === null || journal === null) {
    return (
      <main>
        <AppHeader me={me} actif="passerelle" />
        <section>
          <h2>Passerelle Kolabimo</h2>
          <p>La passerelle n&apos;est pas accessible avec votre rôle.</p>
        </section>
      </main>
    );
  }

  const entrants = journal.filter((e) => e.source === 'kolabimo');
  const sortants = journal.filter((e) => e.source === 'prometis');
  const enErreur = journal.filter((e) => e.statut === 'ERREUR');

  return (
    <main>
      <AppHeader me={me} actif="passerelle" />

      <section>
        <h2>Passerelle Kolabimo</h2>
        <p className="note">
          Kolabimo est maître des lots, des prix et des réservations. Prometis est maître de
          l&apos;échéancier, des appels de fonds et des encaissements. Cet écran montre ce qui
          circule entre les deux.
        </p>
      </section>

      <section>
        <h2>État du raccordement</h2>
        <table>
          <tbody>
            <tr>
              <td>Envoi vers Kolabimo</td>
              <td>
                {etat.sortant.configure ? (
                  <>
                    <strong>configuré</strong> — {etat.sortant.baseUrl}
                  </>
                ) : (
                  <>
                    <strong>non configuré</strong>
                    <br />
                    <span className="meta">
                      Les événements sortants restent en boîte d&apos;envoi et pourront être rejoués
                      dès que l&apos;URL et la clé Kolabimo seront renseignées.
                    </span>
                  </>
                )}
              </td>
            </tr>
            <tr>
              <td>Clés acceptées en entrée</td>
              <td>
                {etat.clesEntrantes.length === 0 && '—'}
                {etat.clesEntrantes.map((c) => (
                  <div key={c.id}>
                    {c.label ?? `clé ${c.id}`}
                    <span className="meta"> · dernier appel {dateCourte(c.lastUsedAt)}</span>
                  </div>
                ))}
                <span className="meta">
                  La valeur d&apos;une clé n&apos;est jamais réaffichée : elle sert aussi de secret
                  de signature.
                </span>
              </td>
            </tr>
            <tr>
              <td>Volumes</td>
              <td>
                {entrants.length} événements reçus · {sortants.length} émis ·{' '}
                <strong>{enErreur.length} en erreur</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {enErreur.length > 0 && (
        <section>
          <h2>À traiter — {enErreur.length}</h2>
          <p className="note">
            Ces événements ne se rejouent pas tout seuls : répéter un traitement qu&apos;on n&apos;a
            pas compris répète surtout le problème.
          </p>
          <table>
            <thead>
              <tr>
                <th>Reçu</th>
                <th>Événement</th>
                <th>Raison</th>
              </tr>
            </thead>
            <tbody>
              {enErreur.map((e) => (
                <tr key={e.id}>
                  <td>{dateCourte(e.receivedAt)}</td>
                  <td>{e.evenement}</td>
                  <td>{e.erreur ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Journal de synchronisation</h2>
        <table>
          <thead>
            <tr>
              <th>Reçu</th>
              <th>Sens</th>
              <th>Événement</th>
              <th>État</th>
              <th>Détail</th>
            </tr>
          </thead>
          <tbody>
            {journal.length === 0 && (
              <tr>
                <td colSpan={5}>Aucun échange pour l&apos;instant.</td>
              </tr>
            )}
            {journal.map((e) => (
              <tr key={e.id}>
                <td>{dateCourte(e.receivedAt)}</td>
                <td>{e.source === 'kolabimo' ? '← Kolabimo' : '→ Kolabimo'}</td>
                <td>{e.evenement}</td>
                <td>{LIBELLE_STATUT[e.statut] ?? e.statut.toLowerCase()}</td>
                <td>
                  {e.erreur ? (
                    <span>{e.erreur}</span>
                  ) : (
                    <span className="meta">{resume(e.payload?.traitement)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

/** Résumé d'une ligne de journal, en une phrase plutôt qu'en JSON brut. */
function resume(traitement: Record<string, unknown> | undefined): string {
  if (!traitement) return '—';
  if (typeof traitement.raison === 'string') return traitement.raison;

  const morceaux: string[] = [];
  if (traitement.action === 'creee')
    morceaux.push(`réservation créée sur le lot ${traitement.lot}`);
  if (traitement.action === 'mise_a_jour') {
    const champs = Array.isArray(traitement.champs) ? traitement.champs.join(', ') : '';
    morceaux.push(`mise à jour : ${champs}`);
  }
  if (traitement.action === 'sans_changement') morceaux.push('déjà à jour');
  if (Array.isArray(traitement.refus) && traitement.refus.length > 0) {
    for (const refus of traitement.refus as { raison: string }[]) morceaux.push(refus.raison);
  }
  return morceaux.join(' · ') || '—';
}
