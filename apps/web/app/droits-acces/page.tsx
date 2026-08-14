import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';

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

  const membres = await apiGet<Membre[]>('/acces/membres');

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

  return (
    <main>
      <AppHeader me={me} actif="droits" />

      <section>
        <h2>Collaborateurs internes</h2>
        <TableMembres membres={internes} />
      </section>

      <section>
        <h2>Intervenants externes</h2>
        <p className="note">
          Rattachés à leur propre société. Leur accès est scopé par opération et, au besoin, par
          module — une entreprise générale peut saisir les soumissions sans jamais voir les ventes.
        </p>
        {externes.length === 0 ? (
          <p>Aucun intervenant externe n&apos;a d&apos;accès à cet espace.</p>
        ) : (
          <TableMembres membres={externes} />
        )}
      </section>
    </main>
  );
}

function TableMembres({ membres }: { membres: Membre[] }) {
  if (membres.length === 0) return <p>Aucun membre.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Personne</th>
          <th>Rôle</th>
          <th>Société</th>
          <th>Accès par opération</th>
          <th>État</th>
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
                  opérations par leur rôle, sans droit ligne à ligne. */}
              {m.role === 'OWNER' || m.role === 'ADMIN' ? (
                <span className="meta">toutes les opérations (par le rôle)</span>
              ) : m.operationAccesses.length === 0 ? (
                <span className="meta">aucune opération confiée</span>
              ) : (
                m.operationAccesses.map((a) => (
                  <div key={a.operationId}>
                    {a.operation.nom} — {LIBELLE_NIVEAU[a.accessLevel] ?? a.accessLevel}
                    {a.modules.length > 0 && (
                      <span className="meta">
                        {' '}
                        · {a.modules.map((x) => x.toLowerCase().replace(/_/g, ' ')).join(', ')}
                      </span>
                    )}
                  </div>
                ))
              )}
            </td>
            <td className={m.isActive ? 'ok' : 'ko'}>{m.isActive ? 'actif' : 'désactivé'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
