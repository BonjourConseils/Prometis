import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { date } from '../../../../lib/format';
import { AjouterEquipement, Proposer, TraiterProposition } from './saisie';

interface Equipement {
  id: number;
  categorie: string;
  designation: string;
  marque: string | null;
  modele: string | null;
  numeroSerie: string | null;
  emplacement: string | null;
  dateMiseEnService: string | null;
  garantieFabricantFin: string | null;
  entretienPeriodiciteMois: number | null;
  notes: string | null;
  lot: { id: number; reference: string } | null;
  entreprise: { id: number; nom: string } | null;
  _count?: { documents: number };
  sourceDocument?: { id: number; titre: string } | null;
  sourceExtrait?: string | null;
}

interface Synthese {
  operation: { id: number; nom: string; commune: string | null };
  equipements: Equipement[];
  propositions: Equipement[];
  echeances: {
    type: string;
    libelle: string;
    fin: string;
    etat: 'ECHUE' | 'PROCHE' | 'EN_COURS';
  }[];
  completude: { categorie: string; libelle: string; presente: boolean }[];
  documents: { id: number; titre: string; categorie: string; fileName: string }[];
  iaDisponible: boolean;
}

interface Lot {
  id: number;
  reference: string;
}
interface Contrat {
  id: number;
  reference: string | null;
  entreprise: { nom: string };
}

const ETAT: Record<string, { texte: string; classe: string }> = {
  ECHUE: { texte: 'échue', classe: 'ko' },
  PROCHE: { texte: 'sous 90 jours', classe: 'avertir' },
  EN_COURS: { texte: 'en cours', classe: 'meta' },
};

const categorie = (c: string) => c.toLowerCase().replace(/_/g, ' ');

/**
 * Le passeport numérique de l'ouvrage.
 *
 * L'écran se lit de haut en bas comme on s'en sert une fois l'immeuble livré :
 * ce qui manque au dossier, ce qui arrive à échéance, puis ce qui est
 * installé. Les propositions de l'IA sont à part, en attente, avec leur
 * citation : elles n'entrent dans le passeport qu'une fois validées.
 */
export default async function PasseportPage({
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

  const [synthese, biens, contrats] = await Promise.all([
    apiGet<Synthese>(`/operations/${operationId}/passeport`),
    apiGet<{ lots: Lot[] }[]>(`/operations/${operationId}/biens`),
    apiGet<Contrat[]>(`/operations/${operationId}/contrats`),
  ]);

  if (!synthese) {
    return (
      <main>
        <AppHeader me={me} actif="passeport" operationId={id} />
        <section>
          <h2>Passeport numérique</h2>
          <p>
            Le passeport numérique n&apos;est pas ouvert pour votre société, ou votre accès à cette
            promotion ne le couvre pas. <Link href="/modules">Voir les modules</Link>.
          </p>
        </section>
      </main>
    );
  }
  if (!synthese.operation) notFound();

  const lectureSeule = me.societe?.modulesLecture?.includes('PASSEPORT') ?? false;
  const lots = (biens ?? []).flatMap((b) => b.lots ?? []);
  const notices = synthese.documents.filter((d) =>
    ['NOTICE', 'PV_RECEPTION', 'GARANTIE', 'CONTRAT_ENTRETIEN'].includes(d.categorie),
  );
  const manquantes = synthese.completude.filter((p) => !p.presente);

  return (
    <main className="large">
      <AppHeader me={me} actif="passeport" operationId={id} />
      <PageHeader
        titre="Passeport numérique"
        contexte={<Link href={`/operations/${operationId}`}>{synthese.operation.nom}</Link>}
      />

      {lectureSeule && (
        <p className="note avertissement">
          Le module est résilié : le passeport reste consultable et exportable, sans limite de temps
          — c&apos;est le document qu&apos;on cherche des années après la livraison. Il ne se
          modifie plus.
        </p>
      )}

      <section>
        <h2>Le dossier</h2>
        <ul className="liste-pieces">
          {synthese.completude.map((p) => (
            <li key={p.categorie} className={p.presente ? 'ok' : 'ko'}>
              {p.presente ? '✓' : '✗'} {p.libelle}
            </li>
          ))}
        </ul>
        {manquantes.length > 0 && (
          <p className="note">
            Les pièces se déposent dans{' '}
            <Link href={`/operations/${operationId}/documents`}>Documents</Link>, avec leur
            catégorie : elles rejoignent le passeport d&apos;elles-mêmes.
          </p>
        )}
        <p>
          {/* Par le relais, qui transmet l'archive telle quelle. */}
          <a className="bouton" href={`/api/prometis/operations/${operationId}/passeport/export`}>
            Exporter le dossier de l&apos;ouvrage (.zip)
          </a>
          <span className="meta">
            {' '}
            — un index PDF et toutes les pièces, lisibles sans Prometis. L&apos;export est
            journalisé.
          </span>
        </p>
      </section>

      <section>
        <h2>Échéances</h2>
        <p className="note">
          Calculées, jamais saisies : la garantie SIA 118 (2 ans) et la prescription des défauts (5
          ans, CO 371) courent dès la réception de chaque contrat ; les garanties et entretiens des
          équipements, dès leur mise en service.
        </p>
        {synthese.echeances.length === 0 ? (
          <p className="meta">
            Aucune échéance : aucun contrat n&apos;est réceptionné, et aucun équipement ne porte de
            garantie ni d&apos;entretien.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Échéance</th>
                <th>Objet</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {synthese.echeances.map((e, i) => (
                <tr key={i} className={e.etat === 'ECHUE' ? 'attenue' : ''}>
                  <td>{date(e.fin)}</td>
                  <td>{e.libelle}</td>
                  <td className={ETAT[e.etat]!.classe}>{ETAT[e.etat]!.texte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {synthese.propositions.length > 0 && (
        <section>
          <h2>À valider — {synthese.propositions.length}</h2>
          <p className="note">
            Proposés par l&apos;IA à partir d&apos;un document. Chacun cite l&apos;extrait dont il
            vient : vérifiez-le, corrigez si besoin, puis validez. Rien n&apos;entre dans le
            passeport sans vous.
          </p>
          {synthese.propositions.map((p) => (
            <article key={p.id} className="proposition">
              <header>
                <strong>{p.designation}</strong>
                <span className="meta">
                  {' '}
                  · {categorie(p.categorie)}
                  {p.marque ? ` · ${p.marque}` : ''}
                  {p.modele ? ` ${p.modele}` : ''}
                </span>
              </header>
              {p.sourceExtrait && (
                <blockquote>
                  « {p.sourceExtrait} »
                  {p.sourceDocument && <cite> — {p.sourceDocument.titre}</cite>}
                </blockquote>
              )}
              {p.notes && <p className="meta">{p.notes}</p>}
              {!lectureSeule && <TraiterProposition operationId={id} equipementId={p.id} />}
            </article>
          ))}
        </section>
      )}

      <section>
        <h2>Équipements — {synthese.equipements.length}</h2>
        {synthese.equipements.length === 0 ? (
          <p className="meta">Aucun équipement enregistré.</p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Équipement</th>
                  <th>Où</th>
                  <th>Posé par</th>
                  <th>Mise en service</th>
                  <th>Garantie fabricant</th>
                  <th>Entretien</th>
                </tr>
              </thead>
              <tbody>
                {synthese.equipements.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.designation}</strong>
                      <br />
                      <span className="meta">
                        {categorie(e.categorie)}
                        {e.marque ? ` · ${e.marque}` : ''}
                        {e.modele ? ` ${e.modele}` : ''}
                        {e.numeroSerie ? ` · n° ${e.numeroSerie}` : ''}
                      </span>
                    </td>
                    <td>{e.lot ? `lot ${e.lot.reference}` : 'parties communes'}</td>
                    <td>{e.entreprise?.nom ?? '—'}</td>
                    <td>{e.dateMiseEnService ? date(e.dateMiseEnService) : '—'}</td>
                    <td>
                      {e.garantieFabricantFin ? `jusqu'au ${date(e.garantieFabricantFin)}` : '—'}
                    </td>
                    <td>
                      {e.entretienPeriodiciteMois
                        ? `tous les ${e.entretienPeriodiciteMois} mois`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!lectureSeule && (
          <AjouterEquipement
            operationId={id}
            lots={lots.map((l) => ({ id: l.id, libelle: `lot ${l.reference}` }))}
            contrats={(contrats ?? []).map((c) => ({
              id: c.id,
              libelle: `${c.entreprise.nom}${c.reference ? ` — ${c.reference}` : ''}`,
            }))}
          />
        )}
      </section>

      {!lectureSeule && (
        <section>
          <h2>Proposer à partir d&apos;un document</h2>
          {synthese.iaDisponible ? (
            <>
              <p className="note">
                Choisissez une notice, un PV de réception ou une fiche de garantie : l&apos;IA en
                relève les équipements, hébergée chez Infomaniak, en Suisse. Les adresses e-mail,
                téléphones et IBAN sont retirés avant l&apos;envoi, et chaque proposition cite
                l&apos;extrait dont elle vient — une citation introuvable dans le document fait
                écarter la proposition.
              </p>
              {notices.length === 0 ? (
                <p className="meta">
                  Aucun document de ce type : déposez-en un dans{' '}
                  <Link href={`/operations/${operationId}/documents`}>Documents</Link>.
                </p>
              ) : (
                <Proposer
                  operationId={id}
                  documents={notices.map((d) => ({ id: d.id, libelle: d.titre }))}
                />
              )}
            </>
          ) : (
            <p className="note">
              La proposition automatique n&apos;est pas disponible sur ce serveur. Les équipements
              se saisissent à la main, ci-dessus.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
