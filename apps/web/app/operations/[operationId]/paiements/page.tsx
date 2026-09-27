import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date } from '../../../../lib/format';
import { AnnulerOrdre, ComposerOrdre, CompteDePromotion, ViserOrdre, type APayer } from './saisie';

interface Operation {
  id: number;
  nom: string;
  ibanPaiement: string | null;
  bicPaiement: string | null;
}

interface Ordre {
  id: number;
  numero: number;
  libelle: string | null;
  statut: 'BROUILLON' | 'VISE' | 'TRANSMIS' | 'ANNULE';
  dateExecution: string | null;
  viseLe: string | null;
  visePar: string | null;
  transmisLe: string | null;
  nombre: number;
  total: string;
}

const chf = (v: string) =>
  `CHF ${Number(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, '’')}`;

const ETAT: Record<Ordre['statut'], string> = {
  BROUILLON: 'à viser',
  VISE: 'visé — à transmettre',
  TRANSMIS: 'transmis à la banque',
  ANNULE: 'annulé',
};

/**
 * Les ordres de paiement : le bordereau de factures qui part à la banque.
 *
 * Le circuit s'arrête ici. La direction des travaux a visé chaque facture,
 * le promoteur les a validées ; la comptabilité les regroupe, le promoteur
 * vise l'ordre, et le fichier pain.001 se télécharge alors — jamais avant.
 */
export default async function PaiementsPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  const id = Number(operationId);

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [aPayer, ordres, droits] = await Promise.all([
    apiGet<APayer[]>(`/operations/${operationId}/ordres-paiement/a-payer`),
    apiGet<Ordre[]>(`/operations/${operationId}/ordres-paiement`),
    apiGet<{ operations: { id: number; accessLevel: string }[] }>('/acces/mes-droits'),
  ]);

  if (aPayer === null || ordres === null) {
    return (
      <main>
        <AppHeader me={me} actif="factures" operationId={id} />
        <section>
          <h2>Paiements</h2>
          <p>Votre accès à cette promotion ne couvre pas les factures.</p>
        </section>
      </main>
    );
  }

  const gerer = droits?.operations.find((o) => o.id === id)?.accessLevel === 'MANAGE';
  const promoteur = ['OWNER', 'ADMIN'].includes(me.membership?.role ?? '');

  return (
    <main className="large">
      <AppHeader me={me} actif="factures" operationId={id} />

      <PageHeader
        titre="Ordres de paiement"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}/factures`}>Factures</Link>{' '}
        <span aria-hidden="true">›</span> Paiements
      </div>

      <section>
        {gerer && promoteur ? (
          <CompteDePromotion
            operationId={id}
            iban={operation.ibanPaiement}
            bic={operation.bicPaiement}
          />
        ) : (
          <p>
            Compte de la promotion : <strong>{operation.ibanPaiement ?? 'non renseigné'}</strong>
          </p>
        )}
      </section>

      <section>
        <h2>À payer</h2>
        {gerer ? (
          <ComposerOrdre
            operationId={id}
            factures={aPayer}
            compteRenseigne={Boolean(operation.ibanPaiement)}
          />
        ) : (
          <p className="meta">
            {aPayer.length} facture{aPayer.length > 1 ? 's' : ''} validée
            {aPayer.length > 1 ? 's' : ''} en attente de paiement.
          </p>
        )}
      </section>

      <section>
        <h2>Les ordres</h2>
        {ordres.length === 0 ? (
          <p className="meta">Aucun ordre pour l’instant.</p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Libellé</th>
                  <th>Exécution</th>
                  <th className="nombre">Factures</th>
                  <th className="nombre">Total</th>
                  <th>État</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ordres.map((o) => (
                  <tr key={o.id}>
                    <td>{o.numero}</td>
                    <td>
                      {o.libelle ?? '—'}
                      {o.visePar && (
                        <>
                          <br />
                          <span className="meta">
                            visé par {o.visePar} le {date(o.viseLe)}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{o.dateExecution ? date(o.dateExecution) : '—'}</td>
                    <td className="nombre">{o.nombre}</td>
                    <td className="nombre">{chf(o.total)}</td>
                    <td>{ETAT[o.statut]}</td>
                    <td>
                      {o.statut === 'BROUILLON' && gerer && promoteur && (
                        <ViserOrdre
                          operationId={id}
                          ordreId={o.id}
                          total={o.total}
                          nombre={o.nombre}
                        />
                      )}
                      {o.statut === 'BROUILLON' && gerer && !promoteur && (
                        <span className="meta">en attente du visa du promoteur</span>
                      )}
                      {(o.statut === 'VISE' || o.statut === 'TRANSMIS') && gerer && (
                        <a
                          href={`/api/prometis/operations/${id}/ordres-paiement/${o.id}/fichier`}
                          download={`ordre-paiement-${o.numero}.xml`}
                        >
                          {o.statut === 'VISE'
                            ? 'Télécharger pour la banque'
                            : 'Retélécharger le fichier'}
                        </a>
                      )}{' '}
                      {o.statut === 'BROUILLON' && gerer && (
                        <AnnulerOrdre operationId={id} ordreId={o.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="meta">
          Le fichier suit la norme <strong>pain.001</strong> (ISO 20022), celle qu’acceptent les
          banques suisses. Les références des QR-factures y sont reprises : le rapprochement se fait
          seul au retour. Le télécharger vaut transmission — les factures passent à « payée ».
        </p>
      </section>
    </main>
  );
}
