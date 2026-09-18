import { redirect } from 'next/navigation';
import { apiGet, getToken, lirePayload } from '../../lib/session';
import { AppHeader, type Me } from '../components/app-header';
import { PageHeader } from '../components/page-header';
import { date, francs } from '../../lib/format';
import { AjouterModule, Portail, Reprendre, Resilier, Souscrire } from './facturation';

export interface EtatModules {
  societe: { id: number; raisonSociale: string; profil: string };
  socle: string[];
  modules: {
    code: string;
    libelle: string;
    promesse: string;
    seul: string | null;
    techniques: string[];
    eligible: boolean;
    statut: 'NON_SOUSCRIT' | 'ESSAI' | 'ACTIF' | 'RESILIE';
    depuis: string | null;
    finEssai: string | null;
    resilieLe: string | null;
    finAcces?: string | null;
  }[];
  historique: {
    id: number;
    module: string;
    de: string | null;
    vers: string;
    source: string;
    raison: string | null;
    createdAt: string;
  }[];
}

export const LIBELLE_TECHNIQUE: Record<string, string> = {
  FONCIER: 'Foncier',
  BUDGET_CFC: 'Budget CFC',
  ECARTS: 'Écarts',
  SUIVI_CHANTIER: 'Suivi de chantier',
  ACTEURS: 'Acteurs',
  GED: 'Documents',
  SEANCES: 'Séances & PV',
  SOUMISSIONS: 'Soumissions',
  ADJUDICATIONS: 'Adjudications',
  CONTRATS: 'Contrats',
  FACTURES: 'Factures',
  LOTS: 'Lots',
  ACQUEREURS: 'Acquéreurs',
  BILAN_PROMOTEUR: 'Bilan promoteur',
  ECHEANCIER: 'Échéancier',
  APPELS_FONDS: 'Appels de fonds',
  TRESORERIE: 'Trésorerie',
  COURTAGE: 'Courtage',
  PASSEPORT: 'Passeport',
};

/** Ce que rend `/facturation` — aux administrateurs seulement. */
interface Offre {
  ouverte: boolean;
  portail: boolean;
  essaiPermis: boolean;
  dureeEssaiJours: number;
  abonnement: {
    statut: string | null;
    vivant: boolean;
    finPeriode: string | null;
    annulationFinPeriode: boolean;
    essaiFinLe: string | null;
  } | null;
  modules: (EtatModules['modules'][number] & {
    vendable: boolean;
    prixMensuel: string | null;
    factureParStripe: boolean;
  })[];
}

const STATUT: Record<string, { texte: string; classe: string }> = {
  ACTIF: { texte: 'Actif', classe: 'ok' },
  ESSAI: { texte: 'Essai', classe: 'ok' },
  RESILIE: { texte: 'Lecture seule', classe: 'meta' },
  NON_SOUSCRIT: { texte: 'Non souscrit', classe: 'meta' },
};

/**
 * Mes modules — ce que la société a, ce qui existe, et depuis quand.
 *
 * Lisible par tout membre : savoir pourquoi un écran manque fait partie de
 * l'usage normal. La souscription, elle, ne se fait pas ici tant que le
 * paiement en ligne n'est pas ouvert — la page le dit, avec un contact.
 */
export default async function ModulesPage() {
  const token = await getToken();
  if (!token) redirect('/login');
  if (!lirePayload(token)?.sid) redirect('/espaces');

  const me = await apiGet<Me>('/auth/me');
  if (!me) redirect('/login');

  const [etat, offre] = await Promise.all([
    apiGet<EtatModules>('/modules'),
    // Réservée aux administrateurs : pour les autres membres, `null`, et la
    // page reste une page de lecture.
    apiGet<Offre>('/facturation'),
  ]);
  const vivant = offre?.abonnement?.vivant ?? false;
  const maintenant = Date.now();
  const offreDe = (code: string) => offre?.modules.find((m) => m.code === code);
  const aSouscrire =
    offre?.ouverte && !vivant
      ? offre.modules.filter(
          (m) =>
            m.eligible && m.vendable && (m.statut === 'NON_SOUSCRIT' || m.statut === 'RESILIE'),
        )
      : [];
  const echeance = offre?.abonnement
    ? offre.abonnement.statut === 'trialing'
      ? offre.abonnement.essaiFinLe
      : offre.abonnement.finPeriode
    : null;

  return (
    <main>
      <AppHeader me={me} actif="modules" />
      <PageHeader titre="Mes modules" contexte={me.societe?.raisonSociale} />

      {etat === null ? (
        <section>
          <p className="ko">Lecture impossible.</p>
        </section>
      ) : (
        <>
          <section>
            <h2>Le socle — toujours inclus</h2>
            <p className="note">
              Le budget CFC et le fil rouge financier sont la base de tout le reste : une facture
              s&apos;impute sur un poste CFC, un appel d&apos;offres se lance depuis un poste CFC.
              Ils ne s&apos;achètent pas à part.
            </p>
            <p>{etat.socle.map((m) => LIBELLE_TECHNIQUE[m] ?? m).join(' · ')}</p>
          </section>

          <section>
            <h2>Les modules</h2>
            <div className="cartes-modules">
              {etat.modules
                .filter((m) => m.eligible)
                .map((m) => {
                  const s = STATUT[m.statut]!;
                  const o = offreDe(m.code);
                  const resiliationProgrammee =
                    m.finAcces != null && new Date(m.finAcces).getTime() > maintenant;
                  const ouvert = m.statut === 'ACTIF' || m.statut === 'ESSAI';
                  return (
                    <article key={m.code} className={`carte-module ${m.statut.toLowerCase()}`}>
                      <header>
                        <h3>{m.libelle}</h3>
                        <span className={`badge ${s.classe}`}>{s.texte}</span>
                      </header>
                      <p>{m.promesse}</p>
                      <p className="meta">
                        Ouvre : {m.techniques.map((t) => LIBELLE_TECHNIQUE[t] ?? t).join(' · ')}
                      </p>
                      {m.statut === 'ACTIF' && m.depuis && (
                        <p className="meta">Actif depuis le {date(m.depuis)}.</p>
                      )}
                      {m.statut === 'ESSAI' && m.finEssai && (
                        <p className="meta">Essai jusqu&apos;au {date(m.finEssai)}.</p>
                      )}
                      {m.statut === 'RESILIE' && (
                        <p className="note">
                          Résilié{m.resilieLe ? ` le ${date(m.resilieLe)}` : ''}. Vos données
                          restent consultables ; elles ne se modifient plus. Rien n&apos;a été
                          effacé.
                        </p>
                      )}
                      {m.statut === 'NON_SOUSCRIT' && m.seul && <p className="note">{m.seul}</p>}
                      {o?.vendable && o.prixMensuel && (
                        <p className="prix">
                          {francs(Math.round(Number(o.prixMensuel) * 100))} HT / mois
                        </p>
                      )}
                      {resiliationProgrammee && (
                        <p className="note avertissement">
                          Résilié : ouvert jusqu&apos;au {date(m.finAcces!)}, puis en lecture seule.
                          Aucun autre prélèvement.
                        </p>
                      )}
                      {offre?.ouverte && o?.vendable && vivant && !ouvert && (
                        <AjouterModule code={m.code} libelle={m.libelle} />
                      )}
                      {/* Revenir sur une résiliation ne coûte rien : la période
                          est payée. Pas d'aperçu, donc, mais un seul bouton. */}
                      {resiliationProgrammee && vivant && o?.vendable && (
                        <Reprendre code={m.code} />
                      )}
                      {o?.factureParStripe && ouvert && !resiliationProgrammee && (
                        <Resilier code={m.code} libelle={m.libelle} jusquAu={echeance} />
                      )}
                    </article>
                  );
                })}
            </div>
            {!offre?.ouverte && (
              <p className="note">
                La souscription en ligne n&apos;est pas ouverte. Pour activer un module ou démarrer
                un essai, écrivez-nous à{' '}
                <a href="mailto:contact@prometis.ch?subject=Activer%20un%20module">
                  contact@prometis.ch
                </a>
                .
              </p>
            )}
          </section>

          {aSouscrire.length > 0 && (
            <section>
              <h2>
                {offre!.essaiPermis ? `Essayer ${offre!.dureeEssaiJours} jours` : 'Souscrire'}
              </h2>
              <Souscrire
                modules={aSouscrire.map((m) => ({
                  code: m.code,
                  libelle: m.libelle,
                  prixMensuel: m.prixMensuel!,
                }))}
                essaiPermis={offre!.essaiPermis}
                dureeEssaiJours={offre!.dureeEssaiJours}
              />
            </section>
          )}

          {offre?.abonnement && (
            <section>
              <h2>Votre abonnement</h2>
              <p>
                {offre.abonnement.statut === 'trialing' &&
                  `Essai jusqu'au ${date(offre.abonnement.essaiFinLe)}.`}
                {offre.abonnement.statut === 'active' &&
                  `Actif · prochaine échéance le ${date(offre.abonnement.finPeriode)}.`}
                {offre.abonnement.statut === 'past_due' &&
                  'Le dernier prélèvement a échoué : mettez à jour votre carte. Vos modules restent ouverts en attendant.'}
                {offre.abonnement.statut === 'canceled' &&
                  'Résilié. Vos données restent consultables.'}
                {offre.abonnement.annulationFinPeriode &&
                  ` Annulation le ${date(echeance)} — aucun autre prélèvement.`}
              </p>
              {offre.portail && <Portail />}
            </section>
          )}

          {etat.historique.length > 0 && (
            <section>
              <h2>Historique</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Module</th>
                    <th>Changement</th>
                  </tr>
                </thead>
                <tbody>
                  {etat.historique.map((h) => (
                    <tr key={h.id}>
                      <td>{date(h.createdAt)}</td>
                      <td>{etat.modules.find((m) => m.code === h.module)?.libelle ?? h.module}</td>
                      <td>
                        {h.de ? `${STATUT[h.de]?.texte ?? h.de} → ` : ''}
                        {STATUT[h.vers]?.texte ?? h.vers}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
