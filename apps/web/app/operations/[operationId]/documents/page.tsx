import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date, lisible } from '../../../../lib/format';

interface Document {
  id: number;
  titre: string;
  description: string | null;
  categorie: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  version: number;
  isCourant: boolean;
  visibiliteExterne: boolean;
  createdAt: string;
  _count: { versions: number };
  lot: { reference: string } | null;
  seance: { titre: string } | null;
}

interface Operation {
  id: number;
  nom: string;
}

/** « 1048576 » → « 1.0 Mo ». Les tailles se lisent, elles ne se comptent pas. */
function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * GED de l'opération.
 *
 * Les documents sont groupés par catégorie, et seule la **version courante**
 * de chacun est listée : une GED qui déroule toutes les versions à plat
 * devient illisible dès la deuxième révision d'un plan. Le compteur de
 * versions dit qu'il y a un historique, et où le trouver.
 */
export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'documents';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const documents = await apiGet<Document[]>(`/operations/${operationId}/documents`);

  if (documents === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Documents</h2>
          <p>
            Le module GED n&apos;est pas activé sur cette société, ou votre accès à l&apos;opération
            ne le couvre pas.
          </p>
        </section>
      </main>
    );
  }

  const parCategorie = new Map<string, Document[]>();
  for (const document of documents) {
    const liste = parCategorie.get(document.categorie) ?? [];
    liste.push(document);
    parCategorie.set(document.categorie, liste);
  }

  const partages = documents.filter((d) => d.visibiliteExterne);

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Documents"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <section>
        <p className="note">
          {documents.length} document{documents.length > 1 ? 's' : ''} dans leur version courante.
          {partages.length > 0 && (
            <>
              {' '}
              <strong>{partages.length}</strong> partagé{partages.length > 1 ? 's' : ''} hors de la
              société.
            </>
          )}
        </p>
      </section>

      {documents.length === 0 && (
        <section>
          <p>Aucune pièce déposée pour l&apos;instant.</p>
        </section>
      )}

      {[...parCategorie.entries()].map(([categorie, liste]) => (
        <section key={categorie}>
          <h2>
            {lisible(categorie)} — {liste.length}
          </h2>
          <table>
            <thead>
              <tr>
                <th>Titre</th>
                <th>Fichier</th>
                <th>Rattachement</th>
                <th className="droite">Version</th>
                <th>Déposé le</th>
                <th>Diffusion</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.titre}</strong>
                    {d.description && (
                      <>
                        <br />
                        <span className="meta">{d.description}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {d.fileName}
                    <br />
                    <span className="meta">{taille(d.fileSize)}</span>
                  </td>
                  <td>
                    {d.lot
                      ? `lot ${d.lot.reference}`
                      : d.seance
                        ? `séance « ${d.seance.titre} »`
                        : '—'}
                  </td>
                  <td className="droite">
                    v{d.version}
                    {d._count.versions > 0 && (
                      <>
                        <br />
                        <span className="meta">{d._count.versions} antérieure(s)</span>
                      </>
                    )}
                  </td>
                  <td>{date(d.createdAt)}</td>
                  <td>
                    {d.visibiliteExterne ? (
                      <strong>externe</strong>
                    ) : (
                      <span className="meta">interne</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
