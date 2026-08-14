import { redirect } from 'next/navigation';
import { apiGet, getToken } from '../../lib/session';
import { WorkspaceList, type WorkspaceItem } from './workspace-list';

/**
 * Sélecteur d'espace de travail.
 *
 * Cette page existe parce qu'un compte peut appartenir à plusieurs sociétés —
 * un collaborateur d'entreprise générale travaillant pour deux promoteurs a un
 * seul identifiant, et deux espaces strictement cloisonnés.
 */
export default async function EspacesPage() {
  if (!(await getToken())) redirect('/login');

  const workspaces = await apiGet<WorkspaceItem[]>('/auth/workspaces');
  if (workspaces === null) redirect('/login');

  return (
    <main className="etroit">
      <h1>Espace de travail</h1>
      <p className="lede">
        Chaque société est un tenant isolé. Les données ne circulent pas de l&apos;une à
        l&apos;autre.
      </p>

      <section>
        <WorkspaceList workspaces={workspaces} />
      </section>
    </main>
  );
}
