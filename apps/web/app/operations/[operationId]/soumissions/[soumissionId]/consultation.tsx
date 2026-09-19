'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi, champ, televerser } from '../../../../../lib/api-client';
import { montant } from '../../../../../lib/format';
import { Repliable, useEnvoi } from '../../../../components/formulaire';

/**
 * La consultation, côté promoteur : le dossier qu'on envoie, l'envoi, les
 * critères et les notes, les options et variantes, la lecture d'une offre par
 * l'IA, les questions des entreprises.
 */

const base = (op: number, s: number) => `/operations/${op}/soumissions/${s}`;

/** `datetime-local` attend l'heure locale sans fuseau. */
function versChampDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------
//  Dossier
// ---------------------------------------------------------------------

export function Dossier({
  operationId,
  soumissionId,
  valeurs,
  envoyee,
}: {
  operationId: number;
  soumissionId: number;
  valeurs: {
    descriptif: string | null;
    conditions: string | null;
    delaiExecution: string | null;
    dateLimite: string | null;
    offresScellees: boolean;
  };
  envoyee: boolean;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [enregistre, setEnregistre] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const dateLimite = champ(d.get('dateLimite'));
    const ok = await envoyer(
      base(operationId, soumissionId),
      {
        descriptif: champ(d.get('descriptif')) ?? null,
        conditions: champ(d.get('conditions')) ?? null,
        delaiExecution: champ(d.get('delaiExecution')) ?? null,
        dateLimite: dateLimite ? new Date(dateLimite).toISOString() : null,
        ...(envoyee ? {} : { offresScellees: d.get('offresScellees') === 'on' }),
      },
      'PATCH',
    );
    setEnregistre(ok);
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Ce que vous demandez
        <textarea
          name="descriptif"
          rows={6}
          defaultValue={valeurs.descriptif ?? ''}
          placeholder="Crépis et enduits intérieurs, env. 1 200 m², selon plans et descriptif joints…"
        />
      </label>
      <label>
        Conditions
        <textarea
          name="conditions"
          rows={3}
          defaultValue={valeurs.conditions ?? ''}
          placeholder="Norme SIA 118. Retenue de garantie 10 %. Prix fermes jusqu’à la fin des travaux."
        />
      </label>
      <div className="grille-3">
        <label>
          Délai d’exécution
          <input
            name="delaiExecution"
            defaultValue={valeurs.delaiExecution ?? ''}
            placeholder="Mars à mai 2027"
          />
        </label>
        <label>
          Date limite de remise
          <input
            name="dateLimite"
            type="datetime-local"
            defaultValue={versChampDate(valeurs.dateLimite)}
          />
        </label>
        <label className="case">
          <input
            type="checkbox"
            name="offresScellees"
            defaultChecked={valeurs.offresScellees}
            disabled={envoyee}
          />{' '}
          Offres sous pli scellé
          <span className="meta">
            {envoyee
              ? ' — annoncé aux entreprises, ne se change plus.'
              : ' — les offres déposées en ligne restent fermées jusqu’à la date limite, puis s’ouvrent toutes ensemble.'}
          </span>
        </label>
      </div>
      {envoyee && (
        <p className="note">
          Déjà envoyée : la date limite peut être repoussée, pas avancée. Tout changement est
          annoncé aux entreprises, dans les mêmes termes pour toutes.
        </p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      {enregistre && !erreur && <p className="ok">Enregistré.</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le dossier'}
      </button>
    </form>
  );
}

/** Une pièce du dossier : diffusée aux entreprises invitées, et à elles seules. */
export function AjouterPiece({
  operationId,
  soumissionId,
}: {
  operationId: number;
  soumissionId: number;
}) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    const fichier = d.get('fichier');
    if (!(fichier instanceof File) || !fichier.size) return setErreur('Choisissez un fichier.');
    setEnCours(true);
    setErreur(null);
    const res = await televerser(`/operations/${operationId}/documents`, fichier, {
      titre: champ(d.get('titre')) ?? fichier.name,
      categorie: 'SOUMISSION',
      soumissionId,
      visibiliteExterne: true,
    });
    setEnCours(false);
    if (!res.ok) return setErreur(res.erreur ?? 'Dépôt impossible.');
    form.reset();
    router.refresh();
  }

  return (
    <Repliable libelle="Ajouter une pièce au dossier">
      {() => (
        <form onSubmit={onSubmit} className="form">
          <div className="grille-2">
            <label>
              Fichier
              <input type="file" name="fichier" required />
            </label>
            <label>
              Titre
              <input name="titre" placeholder="Plans d’exécution, rez" />
            </label>
          </div>
          <p className="meta">
            La pièce est visible des entreprises invitées à cette soumission, et d’elles seules.
          </p>
          {erreur && <p className="ko">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            {enCours ? 'Dépôt…' : 'Déposer'}
          </button>
        </form>
      )}
    </Repliable>
  );
}

// ---------------------------------------------------------------------
//  Envoi
// ---------------------------------------------------------------------

/**
 * Envoyer le dossier aux entreprises invitées — un récapitulatif d'abord :
 * qui le recevra, à quelle adresse, et qui ne le recevra pas faute d'adresse.
 */
export function EnvoyerInvitations({
  operationId,
  soumissionId,
  destinataires,
  libelle = 'Envoyer le dossier',
  entrepriseIds,
}: {
  operationId: number;
  soumissionId: number;
  destinataires: { nom: string; email: string | null }[];
  libelle?: string;
  entrepriseIds?: number[];
}) {
  const router = useRouter();
  const [recap, setRecap] = useState(false);
  const [resultat, setResultat] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const avec = destinataires.filter((d) => d.email);
  const sans = destinataires.filter((d) => !d.email);

  async function confirmer() {
    setEnCours(true);
    setErreur(null);
    const res = await appelApi<{ envoyees: string[]; sansEmail: string[] }>(
      `${base(operationId, soumissionId)}/envoyer`,
      { methode: 'POST', corps: { entrepriseIds } },
    );
    setEnCours(false);
    if (!res.ok) return setErreur(res.erreur ?? 'Envoi impossible.');
    setRecap(false);
    setResultat(
      `Envoyé à ${res.data.envoyees.join(', ') || 'personne'}` +
        (res.data.sansEmail.length ? ` · sans adresse : ${res.data.sansEmail.join(', ')}` : '') +
        '.',
    );
    router.refresh();
  }

  if (!recap) {
    return (
      <>
        <button type="button" onClick={() => setRecap(true)} disabled={!destinataires.length}>
          {libelle}
        </button>
        {resultat && <p className="ok">{resultat}</p>}
      </>
    );
  }
  return (
    <div className="recapitulatif">
      <p>
        Chaque entreprise reçoit un <strong>lien personnel</strong> ; à l’ouverture, un code à six
        chiffres lui est envoyé à la même adresse. Renvoyer un lien rend l’ancien inutilisable.
      </p>
      <ul>
        {avec.map((d) => (
          <li key={d.nom}>
            {d.nom} — {d.email}
          </li>
        ))}
      </ul>
      {sans.length > 0 && (
        <p className="note avertissement">
          Sans adresse e-mail, donc non envoyé : {sans.map((d) => d.nom).join(', ')}. Complétez le
          répertoire des entreprises.
        </p>
      )}
      <button
        type="button"
        className="principal"
        disabled={enCours || !avec.length}
        onClick={confirmer}
      >
        {enCours ? 'Envoi…' : `Envoyer à ${avec.length} entreprise${avec.length > 1 ? 's' : ''}`}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setRecap(false)}>
        Annuler
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

export function RevoquerAcces({
  operationId,
  soumissionId,
  invitationId,
  entreprise,
}: {
  operationId: number;
  soumissionId: number;
  invitationId: number;
  entreprise: string;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [recap, setRecap] = useState(false);
  if (!recap) {
    return (
      <button type="button" className="lien" onClick={() => setRecap(true)}>
        Retirer l’accès
      </button>
    );
  }
  return (
    <span>
      {entreprise} ne pourra plus ouvrir le dossier ; son offre éventuelle reste.{' '}
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          envoyer(`${base(operationId, soumissionId)}/invitations/${invitationId}/revoquer`)
        }
      >
        Confirmer
      </button>{' '}
      <button type="button" className="lien" onClick={() => setRecap(false)}>
        Annuler
      </button>
      {erreur && <span className="ko"> {erreur}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------
//  Questions
// ---------------------------------------------------------------------

export function Repondre({
  operationId,
  soumissionId,
  questionId,
  reponse,
}: {
  operationId: number;
  soumissionId: number;
  questionId: number;
  reponse: string | null;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(`${base(operationId, soumissionId)}/questions/${questionId}/reponse`, {
      reponse: String(d.get('reponse') ?? ''),
      publier: d.get('publier') === 'on',
    });
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <textarea name="reponse" rows={3} required defaultValue={reponse ?? ''} />
      <label className="case">
        <input type="checkbox" name="publier" defaultChecked /> Publier à tous les invités
        <span className="meta">
          {' '}
          — la question et la réponse partent à toutes les entreprises, sans le nom de celle qui a
          demandé.
        </span>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Envoi…' : 'Répondre'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Critères et notes
// ---------------------------------------------------------------------

interface Critere {
  id?: number;
  libelle: string;
  poids: string;
  estPrix: boolean;
}

const CRITERES_TYPES: Critere[] = [
  { libelle: 'Prix', poids: '60', estPrix: true },
  { libelle: 'Références', poids: '25', estPrix: false },
  { libelle: 'Délais', poids: '15', estPrix: false },
];

export function Criteres({
  operationId,
  soumissionId,
  criteres,
}: {
  operationId: number;
  soumissionId: number;
  criteres: Critere[];
}) {
  const [lignes, setLignes] = useState<Critere[]>(criteres.length ? criteres : CRITERES_TYPES);
  const { envoyer, erreur, enCours } = useEnvoi();
  const total = lignes.reduce((t, l) => t + (Number(l.poids) || 0), 0);
  const maj = (i: number, champ: Partial<Critere>) =>
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...champ } : l)));

  return (
    <Repliable libelle={criteres.length ? 'Modifier les critères' : 'Définir les critères'}>
      {(fermer) => (
        <div className="form">
          <table>
            <thead>
              <tr>
                <th>Critère</th>
                <th className="droite">Poids (%)</th>
                <th>Prix</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={l.libelle}
                      onChange={(e) => maj(i, { libelle: e.target.value })}
                    />
                  </td>
                  <td className="droite">
                    <input
                      value={l.poids}
                      inputMode="decimal"
                      size={5}
                      onChange={(e) => maj(i, { poids: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={l.estPrix}
                      onChange={(e) => maj(i, { estPrix: e.target.checked })}
                      aria-label="Critère de prix"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="lien"
                      onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}
                    >
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={total === 100 ? 'meta' : 'ko'}>Total : {total} % — il faut 100 %.</p>
          <p className="meta">
            Le critère de prix se note seul : 10 pour le moins-disant, proportionnellement ensuite.
            Les autres se notent de 0 à 10, avec une justification.
          </p>
          <button
            type="button"
            className="lien"
            onClick={() => setLignes((ls) => [...ls, { libelle: '', poids: '0', estPrix: false }])}
          >
            + Ajouter un critère
          </button>{' '}
          <button
            type="button"
            disabled={enCours || total !== 100}
            onClick={async () => {
              const ok = await envoyer(
                `${base(operationId, soumissionId)}/criteres`,
                {
                  criteres: lignes.map((l) => ({
                    libelle: l.libelle,
                    poids: l.poids,
                    estPrix: l.estPrix,
                  })),
                },
                'PUT',
              );
              if (ok) fermer();
            }}
          >
            Enregistrer les critères
          </button>
          {erreur && <p className="ko">{erreur}</p>}
        </div>
      )}
    </Repliable>
  );
}

export function Noter({
  operationId,
  soumissionId,
  offreId,
  criteres,
  notes,
}: {
  operationId: number;
  soumissionId: number;
  offreId: number;
  criteres: { id: number; libelle: string }[];
  notes: { critereId: number; note: string; commentaire: string | null }[];
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  if (!criteres.length) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(
      `${base(operationId, soumissionId)}/offres/${offreId}/notes`,
      {
        notes: criteres
          .filter((c) => champ(d.get(`note-${c.id}`)) !== undefined)
          .map((c) => ({
            critereId: c.id,
            note: String(d.get(`note-${c.id}`)),
            commentaire: champ(d.get(`com-${c.id}`)) ?? null,
          })),
      },
      'PUT',
    );
  }

  return (
    <Repliable libelle="Noter">
      {() => (
        <form onSubmit={onSubmit} className="form">
          {criteres.map((c) => {
            const n = notes.find((x) => x.critereId === c.id);
            return (
              <div key={c.id} className="grille-2">
                <label>
                  {c.libelle} (0 à 10)
                  <input
                    name={`note-${c.id}`}
                    inputMode="decimal"
                    defaultValue={n?.note ?? ''}
                    size={4}
                  />
                </label>
                <label>
                  Justification
                  <input name={`com-${c.id}`} defaultValue={n?.commentaire ?? ''} />
                </label>
              </div>
            );
          })}
          {erreur && <p className="ko">{erreur}</p>}
          <button type="submit" disabled={enCours}>
            Enregistrer les notes
          </button>
        </form>
      )}
    </Repliable>
  );
}

// ---------------------------------------------------------------------
//  Offre saisie : options, variantes, PDF, lecture par l'IA
// ---------------------------------------------------------------------

interface Ligne {
  type: 'OPTION' | 'VARIANTE';
  libelle: string;
  montant: string;
}

export function LignesOffre({
  operationId,
  soumissionId,
  offreId,
  lignes,
}: {
  operationId: number;
  soumissionId: number;
  offreId: number;
  lignes: Ligne[];
}) {
  const [etat, setEtat] = useState<Ligne[]>(lignes);
  const { envoyer, erreur, enCours } = useEnvoi();
  const maj = (i: number, c: Partial<Ligne>) =>
    setEtat((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));

  return (
    <Repliable libelle="Options et variantes">
      {(fermer) => (
        <div className="form">
          {etat.map((l, i) => (
            <div key={i} className="grille-3">
              <select
                value={l.type}
                onChange={(e) => maj(i, { type: e.target.value as Ligne['type'] })}
              >
                <option value="OPTION">Option (en plus)</option>
                <option value="VARIANTE">Variante (à la place)</option>
              </select>
              <input
                value={l.libelle}
                placeholder="Libellé"
                onChange={(e) => maj(i, { libelle: e.target.value })}
              />
              <input
                value={l.montant}
                inputMode="decimal"
                placeholder="Montant HT"
                onChange={(e) => maj(i, { montant: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="lien"
            onClick={() => setEtat((ls) => [...ls, { type: 'OPTION', libelle: '', montant: '' }])}
          >
            + Ajouter
          </button>{' '}
          <button
            type="button"
            disabled={enCours}
            onClick={async () => {
              const ok = await envoyer(
                `${base(operationId, soumissionId)}/offres/${offreId}/lignes`,
                { lignes: etat.filter((l) => l.libelle.trim() && l.montant.trim()) },
                'PUT',
              );
              if (ok) fermer();
            }}
          >
            Enregistrer
          </button>
          {erreur && <p className="ko">{erreur}</p>}
        </div>
      )}
    </Repliable>
  );
}

export function JoindrePdf({
  operationId,
  soumissionId,
  offreId,
  entreprise,
}: {
  operationId: number;
  soumissionId: number;
  offreId: number;
  entreprise: string;
}) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <label className="lien-fichier">
      Joindre le PDF
      <input
        type="file"
        accept="application/pdf"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const res = await televerser(`/operations/${operationId}/documents`, f, {
            titre: `Offre — ${entreprise}`,
            categorie: 'DEVIS',
            soumissionId,
            offreId,
          });
          if (!res.ok) return setErreur(res.erreur ?? 'Dépôt impossible.');
          router.refresh();
        }}
      />
      {erreur && <span className="ko"> {erreur}</span>}
    </label>
  );
}

interface Lecture {
  montant: number | null;
  extraitMontant: string | null;
  remisePct: number | null;
  extraitRemise: string | null;
  lignes: { type: 'OPTION' | 'VARIANTE'; libelle: string; montant: number; extrait: string }[];
  ecartees: number;
}

/**
 * L'IA lit le PDF de l'offre et propose montant, remise, options — chaque
 * valeur avec l'extrait qui la justifie. Rien n'est enregistré avant que
 * vous ne cliquiez « Reprendre ces valeurs ».
 */
export function LireOffre({
  operationId,
  soumissionId,
  offreId,
  entrepriseId,
  saisie,
}: {
  operationId: number;
  soumissionId: number;
  offreId: number;
  entrepriseId: number;
  saisie: boolean;
}) {
  const router = useRouter();
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function lire() {
    setEnCours(true);
    setErreur(null);
    const res = await appelApi<Lecture>(
      `${base(operationId, soumissionId)}/offres/${offreId}/lecture`,
      {
        methode: 'POST',
      },
    );
    setEnCours(false);
    if (!res.ok) return setErreur(res.erreur ?? 'Lecture impossible.');
    setLecture(res.data);
  }

  async function reprendre() {
    if (!lecture) return;
    setEnCours(true);
    const offre = await appelApi(`${base(operationId, soumissionId)}/offres`, {
      methode: 'POST',
      corps: {
        entrepriseId,
        ...(lecture.montant !== null ? { montant: String(lecture.montant) } : {}),
        ...(lecture.remisePct !== null ? { remisePct: String(lecture.remisePct) } : {}),
      },
    });
    const lignes = lecture.lignes.length
      ? await appelApi(`${base(operationId, soumissionId)}/offres/${offreId}/lignes`, {
          methode: 'PUT',
          corps: {
            lignes: lecture.lignes.map((l) => ({
              type: l.type,
              libelle: l.libelle,
              montant: String(l.montant),
            })),
          },
        })
      : { ok: true, erreur: undefined };
    setEnCours(false);
    if (!offre.ok || !lignes.ok)
      return setErreur(offre.erreur ?? lignes.erreur ?? 'Enregistrement impossible.');
    setLecture(null);
    router.refresh();
  }

  if (!lecture) {
    return (
      <>
        <button type="button" className="lien" disabled={enCours} onClick={lire}>
          {enCours ? 'Lecture… (jusqu’à une minute)' : 'Lire le PDF (IA)'}
        </button>
        {erreur && <span className="ko"> {erreur}</span>}
      </>
    );
  }
  return (
    <div className="proposition">
      <p className="meta">
        Proposition de l’IA, hébergée chez Infomaniak en Suisse — à vérifier contre le PDF.
      </p>
      <dl>
        <dt>Montant HT</dt>
        <dd>
          {lecture.montant !== null ? montant(String(lecture.montant)) : 'non trouvé'}
          {lecture.extraitMontant && <blockquote>« {lecture.extraitMontant} »</blockquote>}
        </dd>
        <dt>Remise</dt>
        <dd>
          {lecture.remisePct !== null ? `${lecture.remisePct} %` : 'aucune trouvée'}
          {lecture.extraitRemise && <blockquote>« {lecture.extraitRemise} »</blockquote>}
        </dd>
        {lecture.lignes.map((l, i) => (
          <div key={i}>
            <dt>{l.type === 'OPTION' ? 'Option' : 'Variante'}</dt>
            <dd>
              {l.libelle} — {montant(String(l.montant))}
              <blockquote>« {l.extrait} »</blockquote>
            </dd>
          </div>
        ))}
      </dl>
      {lecture.ecartees > 0 && (
        <p className="meta">
          {lecture.ecartees} valeur(s) écartée(s) : leur citation ne figure pas dans le document.
        </p>
      )}
      {saisie ? (
        <button type="button" disabled={enCours} onClick={reprendre}>
          Reprendre ces valeurs
        </button>
      ) : (
        <p className="meta">
          Offre déposée par l’entreprise : ses montants font foi, la lecture sert à les vérifier.
        </p>
      )}{' '}
      <button type="button" className="lien" onClick={() => setLecture(null)}>
        Fermer
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}
