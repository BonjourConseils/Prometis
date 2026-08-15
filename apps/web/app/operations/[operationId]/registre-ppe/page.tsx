import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { lisible, nombre } from '../../../../lib/format';

interface RegistrePpe {
  parcelles: {
    id: number;
    numero: string;
    egrid: string | null;
    commune: string | null;
    surfaceM2: string | null;
    affectationZone: string | null;
    registreFoncier: string | null;
  }[];
  ppes: {
    id: number;
    numero: string | null;
    dateActeConstitutif: string | null;
    totalMillemes: number;
    note: string | null;
  }[];
  biens: {
    id: number;
    nom: string;
    nature: string;
    sommeMillemes: string;
    lots: {
      id: number;
      reference: string;
      etage: number | null;
      surfaceM2: string | null;
      quotePartPPE: string | null;
      statut: string;
    }[];
  }[];
  controle: {
    totalMillemes: number;
    sommeMillemes: string;
    ecart: string;
    coherent: boolean;
    nombreLots: number;
  };
}

interface Operation {
  id: number;
  nom: string;
}

export default async function RegistrePpePage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'ppe';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [operation, registre] = await Promise.all([
    apiGet<Operation>(`/operations/${operationId}`),
    apiGet<RegistrePpe>(`/operations/${operationId}/registre-ppe`),
  ]);

  if (!operation) notFound();

  if (registre === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Registre PPE</h2>
          <p>
            Votre accès à cette opération ne couvre pas le foncier. Un administrateur peut élargir
            votre périmètre depuis l&apos;écran Droits d&apos;accès.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Registre PPE"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Registre PPE
      </div>

      <section>
        <h2>Contrôle des millièmes</h2>
        <p className={registre.controle.coherent ? 'ok' : 'ko'}>
          {nombre(registre.controle.sommeMillemes)} / {registre.controle.totalMillemes} millièmes
          répartis sur {registre.controle.nombreLots} lots —{' '}
          {registre.controle.coherent
            ? 'la répartition est cohérente.'
            : `écart de ${nombre(registre.controle.ecart)} millièmes à corriger.`}
        </p>
        <p className="note">
          L&apos;écart est calculé et affiché, jamais masqué : une somme qui ne tombe pas juste doit
          se voir ici, pas se découvrir chez le notaire.
        </p>
      </section>

      <section>
        <h2>Parcelles</h2>
        <table>
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Commune</th>
              <th>E-GRID</th>
              <th>Zone</th>
              <th className="droite">Surface</th>
            </tr>
          </thead>
          <tbody>
            {registre.parcelles.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.numero}</strong>
                  {p.registreFoncier && (
                    <>
                      <br />
                      <span className="meta">{p.registreFoncier}</span>
                    </>
                  )}
                </td>
                <td>{p.commune ?? '—'}</td>
                <td>
                  <code>{p.egrid ?? '—'}</code>
                </td>
                <td>{p.affectationZone ?? '—'}</td>
                <td className="droite">{nombre(p.surfaceM2, 'm²')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {registre.ppes.length > 0 && (
        <section>
          <h2>Constitution de PPE</h2>
          <table>
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Acte constitutif</th>
                <th className="droite">Total millièmes</th>
              </tr>
            </thead>
            <tbody>
              {registre.ppes.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero ?? '—'}</td>
                  <td>
                    {p.dateActeConstitutif
                      ? new Date(p.dateActeConstitutif).toLocaleDateString('fr-CH')
                      : '—'}
                    {p.note && (
                      <>
                        <br />
                        <span className="meta">{p.note}</span>
                      </>
                    )}
                  </td>
                  <td className="droite">{p.totalMillemes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {registre.biens.map((bien) => (
        <section key={bien.id}>
          <h2>
            {bien.nom} — {bien.lots.length} lots · {nombre(bien.sommeMillemes)} ‰
          </h2>
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Étage</th>
                <th className="droite">Surface</th>
                <th className="droite">Quote-part</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {bien.lots.map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <strong>{lot.reference}</strong>
                  </td>
                  <td>{lot.etage ?? '—'}</td>
                  <td className="droite">{nombre(lot.surfaceM2, 'm²')}</td>
                  <td className="droite">{nombre(lot.quotePartPPE)} ‰</td>
                  <td>{lisible(lot.statut)}</td>
                </tr>
              ))}
              <tr className="total">
                <td colSpan={3}>Total {bien.nom}</td>
                <td className="droite">{nombre(bien.sommeMillemes)} ‰</td>
                <td />
              </tr>
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
