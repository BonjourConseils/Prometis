import type { Metadata } from 'next';
import { API } from '../../../lib/session';
import { entetesRelais } from '../../../lib/relais';
import { jetonValide, sessionConsultation } from '../../../lib/consultation';
import { date } from '../../../lib/format';
import { Acces, Decliner, DeposerOffre, PoserQuestion } from './espace';

/**
 * L'adresse contient le lien personnel : elle ne doit ni être indexée, ni
 * partir en « referer » vers un site tiers.
 */
export const metadata: Metadata = {
  title: 'Consultation — Prometis',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface Dossier {
  entreprise: string;
  promoteur: string;
  operation: { nom: string; commune: string | null };
  soumission: {
    intitule: string;
    corpsMetier: string | null;
    cfc: { code: string; libelle: string } | null;
    descriptif: string | null;
    conditions: string | null;
    delaiExecution: string | null;
    dateLimite: string | null;
    statut: string;
    offresScellees: boolean;
  };
  depotOuvert: boolean;
  refuseLe: string | null;
  documents: { id: number; titre: string; fileName: string; fileSize: number }[];
  questions: {
    id: number;
    question: string;
    reponse: string | null;
    publiee: boolean;
    mienne: boolean;
    createdAt: string;
  }[];
  offre: {
    montant: string | null;
    remisePct: string | null;
    note: string | null;
    dateReception: string | null;
    statut: string;
    lignes: { type: string; libelle: string; montant: string }[];
    documents: { id: number; fileName: string }[];
  } | null;
}

const heure = (iso: string) =>
  new Date(iso).toLocaleString('fr-CH', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Zurich',
  });

/**
 * L'espace entreprise : un soumissionnaire, sans compte, voit le dossier,
 * pose ses questions et dépose son offre. Il ne voit ni les autres invités,
 * ni leurs offres, ni le budget du promoteur.
 */
export default async function ConsultationPage({ params }: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await params;
  if (!jetonValide(jeton)) return <Refus />;

  const session = await sessionConsultation();
  let dossier: Dossier | null = null;
  if (session) {
    const res = await fetch(`${API}/consultation/${jeton}`, {
      headers: { ...(await entetesRelais()), 'x-consultation-session': session },
      cache: 'no-store',
    });
    if (res.ok) dossier = (await res.json()) as Dossier;
  }

  if (!dossier) {
    return (
      <main className="espace-entreprise">
        <header className="espace-entete">
          <strong>Prometis</strong> · consultation d’entreprises
        </header>
        <section>
          <h1>Accéder à la consultation</h1>
          <Acces jeton={jeton} />
        </section>
      </main>
    );
  }

  const s = dossier.soumission;
  const lien = (id: number) => `/api/consultation/${jeton}/documents/${id}`;

  return (
    <main className="espace-entreprise">
      <header className="espace-entete">
        <strong>Prometis</strong> · consultation pour {dossier.entreprise}
      </header>

      <section>
        <p className="meta">
          {dossier.promoteur} · {dossier.operation.nom}
          {dossier.operation.commune ? `, ${dossier.operation.commune}` : ''}
        </p>
        <h1>{s.intitule}</h1>
        {s.cfc && (
          <p className="meta">
            CFC {s.cfc.code} {s.cfc.libelle}
          </p>
        )}
        {s.dateLimite && (
          <p className={dossier.depotOuvert ? 'note' : 'note avertissement'}>
            Date limite de remise : <strong>{heure(s.dateLimite)}</strong>
            {!dossier.depotOuvert && ' — les dépôts sont fermés.'}
          </p>
        )}
        {s.offresScellees && dossier.depotOuvert && (
          <p className="meta">
            Les offres sont sous pli scellé : {dossier.promoteur} voit qu’une offre est arrivée, pas
            son contenu, jusqu’à la date limite. Elles s’ouvrent toutes ensemble.
          </p>
        )}
      </section>

      <section>
        <h2>Le dossier</h2>
        {s.descriptif && <p className="texte-libre">{s.descriptif}</p>}
        {s.conditions && (
          <>
            <h3>Conditions</h3>
            <p className="texte-libre">{s.conditions}</p>
          </>
        )}
        {s.delaiExecution && (
          <p>
            <strong>Délai d’exécution :</strong> {s.delaiExecution}
          </p>
        )}
        {dossier.documents.length > 0 && (
          <>
            <h3>Pièces</h3>
            <ul>
              {dossier.documents.map((d) => (
                <li key={d.id}>
                  <a href={lien(d.id)} download={d.fileName}>
                    {d.titre}
                  </a>{' '}
                  <span className="meta">({Math.ceil(d.fileSize / 1024)} Ko)</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>Questions</h2>
        {dossier.questions.length === 0 ? (
          <p className="meta">Aucune question pour l’instant.</p>
        ) : (
          dossier.questions.map((q) => (
            <article key={q.id} className="proposition">
              <p>
                <strong>{q.mienne ? 'Votre question' : 'Question d’un soumissionnaire'}</strong>{' '}
                <span className="meta">· {date(q.createdAt)}</span>
              </p>
              <p>{q.question}</p>
              {q.reponse ? (
                <blockquote>{q.reponse}</blockquote>
              ) : (
                <p className="meta">En attente de réponse.</p>
              )}
            </article>
          ))
        )}
        <p className="meta">
          Une réponse publiée l’est pour toutes les entreprises consultées, sans le nom de celle qui
          a demandé.
        </p>
        {dossier.depotOuvert && <PoserQuestion jeton={jeton} />}
      </section>

      <section>
        <h2>Votre offre</h2>
        {dossier.refuseLe ? (
          <p className="note">Vous avez décliné cette consultation le {date(dossier.refuseLe)}.</p>
        ) : (
          <>
            {dossier.offre?.dateReception && (
              <div className="recapitulatif">
                <p>
                  Offre reçue le <strong>{heure(dossier.offre.dateReception)}</strong>
                  {dossier.offre.statut === 'RETENUE' && ' — retenue.'}
                  {dossier.offre.statut === 'ECARTEE' && ' — non retenue.'}
                </p>
                <dl>
                  <dt>Montant HT</dt>
                  <dd>CHF {dossier.offre.montant}</dd>
                  {dossier.offre.remisePct && (
                    <>
                      <dt>Remise</dt>
                      <dd>{dossier.offre.remisePct} %</dd>
                    </>
                  )}
                  {dossier.offre.lignes.map((l, i) => (
                    <div key={i}>
                      <dt>{l.type === 'OPTION' ? 'Option' : 'Variante'}</dt>
                      <dd>
                        {l.libelle} — CHF {l.montant}
                      </dd>
                    </div>
                  ))}
                </dl>
                {dossier.offre.documents.map((d) => (
                  <a key={d.id} href={lien(d.id)} download={d.fileName}>
                    {d.fileName}
                  </a>
                ))}
              </div>
            )}
            {dossier.depotOuvert ? (
              <>
                <DeposerOffre jeton={jeton} remplace={!!dossier.offre?.dateReception} />
                {!dossier.offre?.dateReception && <Decliner jeton={jeton} />}
              </>
            ) : (
              !dossier.offre?.dateReception && (
                <p className="meta">La date limite est passée : plus aucune offre ne se dépose.</p>
              )
            )}
          </>
        )}
      </section>

      <footer className="espace-pied meta">
        Cet espace ne sert qu’à cette consultation. Votre accès expire deux heures après l’ouverture
        et se renouvelle par un nouveau code.
      </footer>
    </main>
  );
}

function Refus() {
  return (
    <main className="espace-entreprise">
      <section>
        <h1>Lien invalide</h1>
        <p>Ce lien n’est pas ou plus valable. Demandez une nouvelle invitation au promoteur.</p>
      </section>
    </main>
  );
}
