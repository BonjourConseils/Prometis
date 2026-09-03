import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { PageHeader } from '../../../components/page-header';
import { chf, date, lisible, montant, pourcentage } from '../../../../lib/format';
import { AjouterEtape, ChangerAvancement, DeclencherEtape, Encaisser, Relancer } from './saisie';
import { nomAcquereur } from '../../../../lib/format';

/** Réduit à ce qui sert ici : les réservations engagées et leur dossier. */
interface Reservation {
  id: number;
  statut: string;
  kolabimoClientRef: string | null;
  lot: { reference: string };
  acquereurs: {
    role: string;
    quotePart: string | null;
    acquereur: {
      id: number;
      nom: string | null;
      prenom: string | null;
      raisonSociale: string | null;
    };
  }[];
  appelsDeFonds: { id: number }[];
}

/** Seuls ces statuts font naître un appel de fonds (voir `calculs.ts`). */
const STATUTS_ENGAGES = ['RESERVE', 'FONDS_VERSES', 'VENDU'];

interface Etape {
  id: number;
  ordre: number;
  libelle: string;
  pourcentage: string | null;
  statut: string;
  dateCompletion: string | null;
  datePrevue: string | null;
  _count: { appelsDeFonds: number };
}

interface Echeancier {
  etapes: Etape[];
  controle: {
    sommePourcentages: string;
    complet: boolean;
    ecart: string;
    nombreEtapesAppelantes: number;
    nombreJalonsSuivi: number;
  };
}

interface Appel {
  id: number;
  numero: string | null;
  pourcentage: string;
  montant: string;
  statut: string;
  dateEcheance: string | null;
  qrReference: string | null;
  reservation: {
    id: number;
    lot: { reference: string };
    acquereur: { nom: string | null; prenom: string | null } | null;
  };
  etape: { ordre: number; libelle: string };
  encaissements: { id: number; montant: string; dateValeur: string; source: string | null }[];
  etat: {
    montantEncaisse: string;
    solde: string;
    soldé: boolean;
    partiellementPaye: boolean;
    enRetard: boolean;
  };
}

interface Operation {
  id: number;
  nom: string;
  kolabimoPromotionId: number | null;
}

const LIBELLE_AVANCEMENT: Record<string, string> = {
  NOT_STARTED: 'à venir',
  IN_PROGRESS: 'en cours',
  COMPLETED: 'terminé',
};

export default async function AppelsDeFondsPage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const { operationId } = await params;
  // Repère de l'entrée active dans la navigation latérale.
  const ongletActif = 'appels';

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [echeancier, appels, reservations] = await Promise.all([
    apiGet<Echeancier>(`/operations/${operationId}/echeancier`),
    apiGet<Appel[]>(`/operations/${operationId}/appels-de-fonds`),
    apiGet<Reservation[]>(`/operations/${operationId}/reservations`),
  ]);

  if (echeancier === null) {
    return (
      <main>
        <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />
        <section>
          <h2>Appels de fonds</h2>
          <p>
            Votre accès à cette promotion ne couvre pas les appels de fonds, ou le module n&apos;est
            pas activé sur cette société.
          </p>
        </section>
      </main>
    );
  }

  const liste = appels ?? [];
  const total = liste.reduce((t, a) => t + Number(a.montant), 0);
  const encaisse = liste.reduce((t, a) => t + Number(a.etat.montantEncaisse), 0);
  const enRetard = liste.filter((a) => a.etat.enRetard);

  const id = Number(operationId);
  const engageesListe = (reservations ?? []).filter((r) => STATUTS_ENGAGES.includes(r.statut));
  const engagees = engageesListe.length;

  // Depuis le 02.09.2026, la fin de jalon se marque dans Kolabimo : c'est ce
  // qui informe les agences, et cela n'oblige pas le promoteur à avoir
  // Prometis. Nous restons maîtres de ce qui en découle.
  const jalonMaitreKolabimo = operation.kolabimoPromotionId !== null;

  // Étapes closes qui appellent : ce sont elles qui peuvent manquer à une
  // réservation arrivée après coup.
  const closesAppelantes = echeancier.etapes.filter(
    (e) => e.statut === 'COMPLETED' && e.pourcentage !== null,
  );
  // Un lot vendu en cours de chantier n'a pas payé les tranches passées — ou
  // les a réglées dans l'acte. Rien n'est appelé d'office : le promoteur
  // tranche, ligne par ligne.
  const aRattraper = engageesListe.filter((r) => r.appelsDeFonds.length < closesAppelantes.length);
  // Un dossier sans personne : Kolabimo ne livre l'identité qu'à FONDS_VERSES.
  const sansIdentite = engageesListe.filter((r) => r.acquereurs.length === 0);
  const ordreSuivant = echeancier.etapes.reduce((max, e) => Math.max(max, e.ordre), 0) + 1;
  // `ecart` est signé (somme − 100) : à zéro pour cent appelé il vaut −100.
  // Ce qui intéresse celui qui saisit, c'est ce qu'il RESTE à répartir.
  const restant = String(-Number(echeancier.controle.ecart));

  return (
    <main className="large">
      <AppHeader me={me} actif={ongletActif} operationId={Number(operationId)} />

      <PageHeader
        titre="Appels de fonds"
        contexte={<Link href={`/operations/${operationId}`}>{operation.nom}</Link>}
      />

      <div className="fil-ariane">
        <Link href="/">Promotions</Link> <span aria-hidden="true">›</span>{' '}
        <Link href={`/operations/${operation.id}`}>{operation.nom}</Link>{' '}
        <span aria-hidden="true">›</span> Appels de fonds
      </div>

      <section>
        <h2>Échéancier</h2>
        <p className={echeancier.controle.complet ? 'ok' : 'ko'}>
          {pourcentage(echeancier.controle.sommePourcentages)} appelés sur{' '}
          {echeancier.controle.nombreEtapesAppelantes} étapes
          {echeancier.controle.complet
            ? ' — l’échéancier couvre bien 100 % du prix.'
            : ` — écart de ${pourcentage(echeancier.controle.ecart)} : une part du prix ne sera jamais appelée.`}
        </p>
        {echeancier.controle.nombreJalonsSuivi > 0 && (
          <p className="note">
            {echeancier.controle.nombreJalonsSuivi} jalon
            {echeancier.controle.nombreJalonsSuivi > 1 ? 's' : ''} de suivi de chantier, sans
            pourcentage : ils ne déclenchent aucun appel de fonds.
          </p>
        )}

        {jalonMaitreKolabimo && (
          <p className="note avertissement">
            Cette promotion est reliée à <strong>Kolabimo</strong> (promotion{' '}
            {operation.kolabimoPromotionId}). Depuis le 2 septembre 2026, la{' '}
            <strong>fin d&apos;étape s&apos;y marque</strong> — c&apos;est ce qui informe les
            agences. Prometis la reçoit et en tire les appels de fonds. Un seul endroit déclenche
            des factures : le bouton n&apos;est donc pas proposé ici.
          </p>
        )}

        <table>
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Jalon</th>
              <th className="droite">%</th>
              <th>Avancement</th>
              <th>Date</th>
              <th className="droite">Appels émis</th>
              <th>Conduite</th>
            </tr>
          </thead>
          <tbody>
            {echeancier.etapes.map((e) => (
              <tr key={e.id} className={e.pourcentage === null ? 'attenue' : ''}>
                <td>{e.ordre}</td>
                <td>{e.libelle}</td>
                <td className="droite">
                  {e.pourcentage === null ? (
                    <span className="meta">suivi</span>
                  ) : (
                    pourcentage(e.pourcentage)
                  )}
                </td>
                <td className={e.statut === 'COMPLETED' ? 'ok' : ''}>
                  {LIBELLE_AVANCEMENT[e.statut] ?? lisible(e.statut)}
                </td>
                <td>
                  {e.dateCompletion ? (
                    date(e.dateCompletion)
                  ) : e.datePrevue ? (
                    <span className="meta">prévu {date(e.datePrevue)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="droite">{e._count.appelsDeFonds}</td>
                <td>
                  <div className="actions-cellule">
                    {/* Un jalon terminé ne se redéclenche pas : le moteur est
                        idempotent, mais proposer le geste laisserait croire
                        qu'il reste quelque chose à faire. */}
                    {e.statut !== 'COMPLETED' && (
                      <>
                        <ChangerAvancement
                          operationId={id}
                          etapeId={e.id}
                          vers={e.statut === 'IN_PROGRESS' ? 'NOT_STARTED' : 'IN_PROGRESS'}
                        />
                        {e.pourcentage !== null && !jalonMaitreKolabimo && (
                          <DeclencherEtape
                            operationId={id}
                            etapeId={e.id}
                            libelle={e.libelle}
                            pourcentage={pourcentage(e.pourcentage)}
                            nombreEngagees={engagees}
                          />
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <AjouterEtape operationId={id} ordreSuivant={ordreSuivant} restant={pourcentage(restant)} />
      </section>

      {(aRattraper.length > 0 || sansIdentite.length > 0) && (
        <section>
          <h2>Dossiers à trancher</h2>

          {aRattraper.length > 0 && (
            <>
              <p className="note">
                {aRattraper.length} lot{aRattraper.length > 1 ? 's ont' : ' a'} été vendu
                {aRattraper.length > 1 ? 's' : ''} alors que des jalons étaient déjà terminés.{' '}
                <strong>Rien n&apos;est appelé d&apos;office</strong> : certaines de ces tranches
                figurent dans l&apos;acte et ont été réglées chez le notaire. Ouvrez le dossier pour
                choisir celles à inclure dans le premier appel.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Dossier</th>
                    <th className="droite">Appels émis</th>
                    <th className="droite">Jalons clos</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {aRattraper.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.lot.reference}</strong>
                      </td>
                      <td>
                        {r.acquereurs.length === 0 ? (
                          <span className="meta">
                            identité non encore livrée
                            {r.kolabimoClientRef ? ` · réf. ${r.kolabimoClientRef}` : ''}
                          </span>
                        ) : (
                          r.acquereurs.map((l) => nomAcquereur(l.acquereur)).join(' · ')
                        )}
                      </td>
                      <td className="droite">{r.appelsDeFonds.length}</td>
                      <td className="droite">{closesAppelantes.length}</td>
                      <td>
                        <Link
                          className="bouton"
                          href={`/operations/${operationId}/appels-de-fonds/rattrapage/${r.id}`}
                        >
                          Choisir les étapes
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {sansIdentite.length > 0 && (
            <p className="note">
              {sansIdentite.length} réservation{sansIdentite.length > 1 ? 's' : ''} sans acquéreur
              nominatif. <strong>C&apos;est normal</strong> : Kolabimo ne livre l&apos;identité
              qu&apos;au palier <code>FONDS_VERSES</code>. Un appel de fonds ne peut pas partir
              avant — il n&apos;aurait aucun destinataire.
            </p>
          )}
        </section>
      )}

      <section>
        <h2>Suivi des encaissements</h2>
        <div className="kpis">
          <div className="kpi">
            <span className="etiquette">Appelé</span>
            <span className="valeur">{chf(String(total))}</span>
            <span className="meta">
              {liste.length} appel{liste.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="kpi positif">
            <span className="etiquette">Encaissé</span>
            <span className="valeur">{chf(String(encaisse))}</span>
          </div>
          <div className={`kpi ${enRetard.length > 0 ? 'negatif' : ''}`}>
            <span className="etiquette">En retard</span>
            <span className="valeur">{enRetard.length}</span>
            <span className="meta">
              {enRetard.length > 0
                ? `${montant(String(enRetard.reduce((t, a) => t + Number(a.etat.solde), 0)))} à recouvrer`
                : 'aucun impayé échu'}
            </span>
          </div>
        </div>

        {liste.length === 0 ? (
          <p>
            Aucun appel de fonds émis. Ils sont générés en marquant un jalon terminé — pour chaque
            réservation engagée, montant = pourcentage × prix total acte.
          </p>
        ) : (
          <div className="tableau-large">
            <table>
              <thead>
                <tr>
                  <th>Appel</th>
                  <th>Lot</th>
                  <th>Acquéreur</th>
                  <th className="droite">%</th>
                  <th className="droite">Montant</th>
                  <th className="droite">Encaissé</th>
                  <th className="droite">Solde</th>
                  <th>Échéance</th>
                  <th>Statut</th>
                  <th>Recouvrement</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((a) => (
                  <tr key={a.id} className={a.etat.enRetard ? 'depassement' : ''}>
                    <td>
                      <strong>{a.numero ?? `#${a.id}`}</strong>
                      <br />
                      <span className="meta">{a.etape.libelle}</span>
                    </td>
                    <td>{a.reservation.lot.reference}</td>
                    <td>{nomAcquereur(a.reservation.acquereur)}</td>
                    <td className="droite">{pourcentage(a.pourcentage)}</td>
                    <td className="droite">{montant(a.montant)}</td>
                    <td className="droite">{montant(a.etat.montantEncaisse)}</td>
                    <td className="droite">{a.etat.soldé ? '—' : montant(a.etat.solde)}</td>
                    <td>{date(a.dateEcheance)}</td>
                    <td className={a.etat.soldé ? 'ok' : a.etat.enRetard ? 'ko' : ''}>
                      {lisible(a.statut)}
                    </td>
                    <td>
                      {a.etat.soldé ? (
                        <span className="meta">soldé</span>
                      ) : (
                        <div className="actions-cellule">
                          <Encaisser operationId={id} appelId={a.id} solde={a.etat.solde} />
                          <Relancer operationId={id} appelId={a.id} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="note">
          Chaque appel porte une <strong>référence QR suisse</strong> déterministe, calculée depuis
          le couple réservation × étape. Rejouer un déclenchement ne crée donc pas de seconde
          créance. L&apos;envoi porte <strong>deux documents</strong> — une lettre à
          l&apos;acquéreur, et un bordereau QR destiné à sa banque, qui paie le plus souvent à sa
          place. Les deux sont déposés en GED. Quand le dossier compte plusieurs personnes, tous
          reçoivent : la créance est <strong>solidaire</strong>, elle ne se divise pas.
        </p>
      </section>
    </main>
  );
}
