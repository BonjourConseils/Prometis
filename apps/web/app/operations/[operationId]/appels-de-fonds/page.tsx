import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../../../lib/session';
import { AppHeader, type Me } from '../../../components/app-header';
import { chf, date, lisible, montant, pourcentage } from '../../../../lib/format';

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
    acquereur: { nom: string | null; prenom: string | null };
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

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const operation = await apiGet<Operation>(`/operations/${operationId}`);
  if (!operation) notFound();

  const [echeancier, appels] = await Promise.all([
    apiGet<Echeancier>(`/operations/${operationId}/echeancier`),
    apiGet<Appel[]>(`/operations/${operationId}/appels-de-fonds`),
  ]);

  if (echeancier === null) {
    return (
      <main>
        <AppHeader me={me} actif="operations" />
        <section>
          <h2>Appels de fonds</h2>
          <p>
            Votre accès à cette opération ne couvre pas les appels de fonds, ou le module n&apos;est
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

  return (
    <main className="large">
      <AppHeader me={me} actif="operations" />

      <div className="fil-ariane">
        <Link href="/">Opérations</Link> <span aria-hidden="true">›</span>{' '}
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

        <table>
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Jalon</th>
              <th className="droite">%</th>
              <th>Avancement</th>
              <th>Date</th>
              <th className="droite">Appels émis</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
                    <td>
                      {[a.reservation.acquereur.prenom, a.reservation.acquereur.nom]
                        .filter(Boolean)
                        .join(' ')}
                    </td>
                    <td className="droite">{pourcentage(a.pourcentage)}</td>
                    <td className="droite">{montant(a.montant)}</td>
                    <td className="droite">{montant(a.etat.montantEncaisse)}</td>
                    <td className="droite">{a.etat.soldé ? '—' : montant(a.etat.solde)}</td>
                    <td>{date(a.dateEcheance)}</td>
                    <td className={a.etat.soldé ? 'ok' : a.etat.enRetard ? 'ko' : ''}>
                      {lisible(a.statut)}
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
          créance. La QR-facture au format PDF n&apos;est pas encore jointe aux envois : sa
          génération attend le choix du stockage de documents.
        </p>
      </section>
    </main>
  );
}
