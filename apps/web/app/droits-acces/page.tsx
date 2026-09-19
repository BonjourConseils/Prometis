import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';
import { date } from '../../lib/format';
import {
  ActionsInvitation,
  FermerPromotion,
  InviterMembre,
  ModifierMembre,
  NommerDirectionTravaux,
  OuvrirPromotion,
  type OperationChoix,
} from './saisie';

interface Invitation {
  id: number;
  email: string;
  prenom: string | null;
  nom: string | null;
  role: string;
  fonction: string | null;
  acteurType: string | null;
  societeNom: string | null;
  acces: { operationId: number }[];
  directionTravauxDe: number[];
  expireLe: string;
  createdAt: string;
}

interface Operation extends OperationChoix {
  directionTravauxId: number | null;
}

const LIBELLE_ACTEUR: Record<string, string> = {
  DIRECTION_TRAVAUX: 'direction des travaux',
  ARCHITECTE: 'architecte',
  INGENIEUR: 'ingénieur',
  BUREAU_TECHNIQUE: 'bureau technique',
  ENTREPRISE_GENERALE: 'entreprise générale',
  PILOTE: 'pilote',
  NOTAIRE: 'notaire',
  AUTRE: 'intervenant',
};
interface Membre {
  id: number;
  role: string;
  fonction: string | null;
  isActive: boolean;
  estExterne: boolean;
  compte: {
    id: number;
    email: string;
    prenom: string | null;
    nom: string | null;
    lastLoginAt: string | null;
  };
  acteur: { id: number; type: string; societeNom: string | null } | null;
  operationAccesses: {
    operationId: number;
    accessLevel: string;
    modules: string[];
    operation: { nom: string };
  }[];
}

const LIBELLE_NIVEAU: Record<string, string> = {
  READ_ONLY: 'lecture',
  OPERATE: 'saisie',
  MANAGE: 'gestion',
};

function nomAffiche(m: Membre): string {
  const complet = [m.compte.prenom, m.compte.nom].filter(Boolean).join(' ');
  return complet || m.compte.email;
}

/**
 * Écran « Droits d'accès ».
 *
 * Deux populations qu'il faut distinguer visuellement : les collaborateurs
 * internes, et les intervenants externes (EG, architecte, notaire) rattachés à
 * leur propre société-acteur et dont l'accès est restreint par module.
 */
export default async function DroitsAccesPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [membres, invitations, operations] = await Promise.all([
    apiGet<Membre[]>('/acces/membres'),
    apiGet<Invitation[]>('/acces/invitations'),
    apiGet<Operation[]>('/operations'),
  ]);
  const ops = operations ?? [];
  const nomOperation = (id: number) => ops.find((o) => o.id === id)?.nom ?? `promotion ${id}`;

  // `null` = l'API a refusé. C'est le comportement attendu pour un rôle non
  // administrateur, et il mérite d'être expliqué plutôt que masqué.
  if (membres === null) {
    return (
      <main>
        <AppHeader me={me} actif="droits" />
        <section>
          <h2>Droits d&apos;accès</h2>
          <p>
            Votre rôle (<code>{me.membership?.role}</code>) ne permet pas de gérer les accès de
            cette société. Cette page est réservée aux propriétaires et administrateurs.
          </p>
        </section>
      </main>
    );
  }

  const internes = membres.filter((m) => !m.estExterne);
  const externes = membres.filter((m) => m.estExterne);
  const moi = me.membership?.id;

  return (
    <main className="large">
      <AppHeader me={me} actif="droits" />
      <PageHeader titre="Équipe et droits d’accès" contexte={me.societe?.raisonSociale} />

      <section>
        <h2>Inviter</h2>
        <p className="note">
          Un employé rejoint la société avec un rôle. Un intervenant externe — architecte, direction
          des travaux — ne voit que les promotions que vous lui ouvrez, et sur chacune les seuls
          modules choisis : jamais les ventes ni les acquéreurs, sauf si vous les cochez.
        </p>
        <InviterMembre operations={ops} />
        {(invitations ?? []).length > 0 && (
          <>
            <h3>Invitations en attente</h3>
            <table>
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>À quel titre</th>
                  <th>Promotions</th>
                  <th>Expire le</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invitations!.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {[i.prenom, i.nom].filter(Boolean).join(' ') || i.email}
                      <br />
                      <span className="meta">{i.email}</span>
                    </td>
                    <td>
                      {i.acteurType
                        ? `${LIBELLE_ACTEUR[i.acteurType] ?? i.acteurType} · ${i.societeNom ?? ''}`
                        : (i.fonction ?? i.role.toLowerCase().replace(/_/g, ' '))}
                    </td>
                    <td>
                      {i.acces.length
                        ? i.acces
                            .map(
                              (a) =>
                                nomOperation(a.operationId) +
                                (i.directionTravauxDe.includes(a.operationId) ? ' (DT)' : ''),
                            )
                            .join(', ')
                        : 'toutes (par le rôle)'}
                    </td>
                    <td>{date(i.expireLe)}</td>
                    <td>
                      <ActionsInvitation id={i.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>Direction des travaux par promotion</h2>
        <p className="note">
          Nommée, la direction des travaux mène le contrôle des factures : elle vise chaque facture
          avant votre approbation. Sans elle, le promoteur valide seul.
        </p>
        <table>
          <tbody>
            {ops.map((o) => {
              const candidats = membres
                .filter(
                  (m) =>
                    m.isActive &&
                    (m.role === 'OWNER' ||
                      m.role === 'ADMIN' ||
                      m.operationAccesses.some(
                        (a) => a.operationId === o.id && a.accessLevel !== 'READ_ONLY',
                      )),
                )
                .map((m) => ({
                  id: m.id,
                  libelle: `${nomAffiche(m)}${m.acteur?.societeNom ? ` — ${m.acteur.societeNom}` : ''}`,
                }));
              return (
                <tr key={o.id}>
                  <td>
                    <strong>{o.nom}</strong>
                  </td>
                  <td>
                    <NommerDirectionTravaux
                      operationId={o.id}
                      actuel={o.directionTravauxId}
                      candidats={candidats}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Collaborateurs internes</h2>
        <TableMembres membres={internes} operations={ops} moi={moi} />
      </section>

      <section>
        <h2>Intervenants externes</h2>
        <p className="note">
          Rattachés à leur propre société. Leur accès est scopé par promotion et, au besoin, par
          module — une entreprise générale peut saisir les soumissions sans jamais voir les ventes.
        </p>
        {externes.length === 0 ? (
          <p>Aucun intervenant externe n&apos;a d&apos;accès à cet espace.</p>
        ) : (
          <TableMembres membres={externes} operations={ops} moi={moi} />
        )}
      </section>
    </main>
  );
}

function TableMembres({
  membres,
  operations,
  moi,
}: {
  membres: Membre[];
  operations: Operation[];
  moi: number | undefined;
}) {
  if (membres.length === 0) return <p>Aucun membre.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Personne</th>
          <th>Rôle</th>
          <th>Société</th>
          <th>Accès par promotion</th>
          <th>État</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {membres.map((m) => (
          <tr key={m.id}>
            <td>
              {nomAffiche(m)}
              <br />
              <span className="meta">{m.compte.email}</span>
            </td>
            <td>
              {m.role.toLowerCase().replace('_', ' ')}
              {m.fonction && (
                <>
                  <br />
                  <span className="meta">{m.fonction}</span>
                </>
              )}
            </td>
            <td>{m.acteur?.societeNom ?? '—'}</td>
            <td>
              {/* Propriétaires et administrateurs couvrent toutes les
                  promotions par leur rôle, sans droit ligne à ligne. */}
              {m.role === 'OWNER' || m.role === 'ADMIN' ? (
                <span className="meta">toutes les promotions (par le rôle)</span>
              ) : m.operationAccesses.length === 0 ? (
                <span className="meta">aucune promotion confiée</span>
              ) : (
                m.operationAccesses.map((a) => (
                  <div key={a.operationId}>
                    {a.operation.nom} — {LIBELLE_NIVEAU[a.accessLevel] ?? a.accessLevel}
                    {operations.find((o) => o.id === a.operationId)?.directionTravauxId ===
                      m.id && <span className="badge">DT</span>}
                    {a.modules.length > 0 && (
                      <span className="meta">
                        {' '}
                        · {a.modules.map((x) => x.toLowerCase().replace(/_/g, ' ')).join(', ')}
                      </span>
                    )}{' '}
                    {m.id !== moi && (
                      <FermerPromotion operationId={a.operationId} membershipId={m.id} />
                    )}
                  </div>
                ))
              )}
            </td>
            <td className={m.isActive ? 'ok' : 'ko'}>{m.isActive ? 'actif' : 'désactivé'}</td>
            <td>
              {m.id === moi ? (
                <span className="meta">vous</span>
              ) : (
                <>
                  <ModifierMembre
                    id={m.id}
                    role={m.role}
                    isActive={m.isActive}
                    externe={m.estExterne}
                  />
                  {m.role !== 'OWNER' && m.role !== 'ADMIN' && (
                    <OuvrirPromotion
                      membershipId={m.id}
                      externe={m.estExterne}
                      operations={operations.filter(
                        (o) => !m.operationAccesses.some((a) => a.operationId === o.id),
                      )}
                    />
                  )}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
