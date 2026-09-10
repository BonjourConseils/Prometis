import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { ActionsConnexion, Copier, SaisirCle } from './saisie';

interface Connexion {
  connectee: boolean;
  baseUrl: string | null;
  cleApercu: string | null;
  promoteur: { id: number; nom: string } | null;
  verifieeLe: string | null;
  derniereErreur: string | null;
  webhook: { url: string } | null;
  chiffrementDisponible: boolean;
}

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

  const [etat, journal, connexion] = await Promise.all([
    apiGet<EtatPasserelle>('/passerelle/etat'),
    apiGet<EvenementJournal[]>('/passerelle/journal?limite=100'),
    apiGet<Connexion>('/passerelle/kolabimo'),
  ]);
  // Poser ou retirer la clé est réservé au titulaire et aux administrateurs :
  // elle ouvre toutes les promotions du promoteur. L'API le refuserait de
  // toute façon ; ne pas proposer le formulaire évite de le découvrir en 403.
  const peutGerer = ['OWNER', 'ADMIN'].includes(me.workspace?.role ?? '');

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
          Kolabimo porte la promotion : lots, prix, réservations, échéancier, et l&apos;identité des
          acquéreurs à partir des fonds versés. Prometis y ajoute ce que Kolabimo ne gère pas —{' '}
          <strong>l&apos;argent</strong> : les appels de fonds, leurs documents, les encaissements.
        </p>
      </section>

      {connexion && (
        <section>
          <h2>Connexion à votre compte Kolabimo</h2>

          {!connexion.chiffrementDisponible && (
            <p className="note avertissement">
              Le serveur n&apos;a pas de clé de chiffrement des intégrations (
              <code>INTEGRATIONS_ENCRYPTION_KEY</code>). La clé Kolabimo sera refusée plutôt que
              stockée en clair.
            </p>
          )}

          {connexion.connectee ? (
            <>
              <table>
                <tbody>
                  <tr>
                    <td>Promoteur</td>
                    <td>
                      <strong>{connexion.promoteur?.nom ?? '—'}</strong>
                      <span className="meta"> · {connexion.baseUrl}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Clé d&apos;API</td>
                    <td>
                      <code>{connexion.cleApercu}</code>
                      <span className="meta"> · jamais réaffichée, chiffrée sur le serveur</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Dernière vérification</td>
                    <td className={connexion.derniereErreur ? 'ko' : 'ok'}>
                      {connexion.derniereErreur ?? `réussie le ${dateCourte(connexion.verifieeLe)}`}
                    </td>
                  </tr>
                </tbody>
              </table>
              {peutGerer && (
                <>
                  <ActionsConnexion />
                  <SaisirCle baseUrlActuelle={connexion.baseUrl} remplacement />
                </>
              )}
              <p>
                <Link className="bouton" href="/passerelle/kolabimo">
                  Voir mes promotions Kolabimo
                </Link>
              </p>
            </>
          ) : peutGerer ? (
            <SaisirCle baseUrlActuelle={connexion.baseUrl} remplacement={false} />
          ) : (
            <p className="note">
              Kolabimo n&apos;est pas encore connecté. Le titulaire du compte ou un administrateur
              peut saisir la clé d&apos;API ici.
            </p>
          )}

          {connexion.webhook && (
            <>
              <h3>Recevoir les événements de Kolabimo</h3>
              <p className="note">
                Pour que Kolabimo informe Prometis d&apos;une réservation ou d&apos;une étape
                terminée, collez dans Kolabimo —{' '}
                <em>Ma société → Intégrations &amp; API → Passerelle Prometis</em> — cette adresse,
                et le secret de signature affiché à la connexion.
              </p>
              <p>
                <code className="secret">{connexion.webhook.url}</code>{' '}
                <Copier valeur={connexion.webhook.url} />
              </p>
              {connexion.webhook.url.includes('localhost') && (
                <p className="note avertissement">
                  Cette adresse pointe sur ce poste de développement : Kolabimo, sur internet, ne
                  peut pas la joindre. En production, <code>PUBLIC_API_URL</code> doit porter
                  l&apos;adresse publique de l&apos;API.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section>
        <h2>État du raccordement</h2>
        <table>
          <tbody>
            <tr>
              <td>Encaissements vers Kolabimo</td>
              <td>
                <strong>pas encore de destinataire</strong>
                <br />
                <span className="meta">
                  Kolabimo n&apos;expose pas encore de route pour les recevoir. Ils restent en boîte
                  d&apos;envoi, rejouables le jour où elle existera.
                </span>
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
                  Clés Prometis de l&apos;ancien contrat interne. Kolabimo, lui, s&apos;authentifie
                  par le secret de signature de la connexion ci-dessus.
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
