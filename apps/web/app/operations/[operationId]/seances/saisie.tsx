'use client';

import { type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

const TYPES: [string, string][] = [
  ['CHANTIER', 'Séance de chantier'],
  ['ADJUDICATION', 'Séance d’adjudication'],
  ['COPIL', 'Comité de pilotage'],
  ['PROMOTEUR', 'Séance promoteur'],
  ['TECHNIQUE', 'Séance technique'],
  ['CLIENT_ACQUEREUR', 'Rendez-vous acquéreur'],
  ['NOTAIRE', 'Rendez-vous notaire'],
  ['AUTRE', 'Autre'],
];

// ---------------------------------------------------------------------
//  Séance
// ---------------------------------------------------------------------

export function AjouterSeance({ operationId }: { operationId: number }) {
  return (
    <Repliable libelle="Planifier une séance">
      {(fermer) => <FormulaireSeance operationId={operationId} fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireSeance({ operationId, fermer }: { operationId: number; fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/seances`, {
      titre: champ(d.get('titre')),
      numero: champ(d.get('numero')),
      type: champ(d.get('type')),
      date: champ(d.get('date')),
      lieu: champ(d.get('lieu')),
      ordreDuJour: champ(d.get('ordreDuJour')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Titre
          <input name="titre" required autoFocus placeholder="Séance de chantier n° 12" />
        </label>
        <label>
          Numéro
          <input name="numero" placeholder="12" />
        </label>
        <label>
          Type
          <select name="type" defaultValue="CHANTIER">
            {TYPES.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grille-2">
        <label>
          Date
          <input name="date" type="date" />
        </label>
        <label>
          Lieu
          <input name="lieu" placeholder="Bureau de chantier" />
        </label>
      </div>
      <label>
        Ordre du jour
        <input name="ordreDuJour" placeholder="Avancement gros œuvre · planning · sécurité" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Planifier'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Participants
// ---------------------------------------------------------------------

/**
 * Ajouter un participant.
 *
 * Le nom libre est accepté : une séance de chantier compte des gens qui ne
 * sont ni des comptes de l'application ni des acteurs enregistrés. Exiger un
 * rattachement ferait perdre la moitié de la feuille de présence.
 */
export function AjouterParticipant({
  operationId,
  seanceId,
}: {
  operationId: number;
  seanceId: number;
}) {
  return (
    <Repliable libelle="Ajouter un participant">
      {(fermer) => (
        <FormulaireParticipant operationId={operationId} seanceId={seanceId} fermer={fermer} />
      )}
    </Repliable>
  );
}

function FormulaireParticipant({
  operationId,
  seanceId,
  fermer,
}: {
  operationId: number;
  seanceId: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/seances/${seanceId}/participants`, {
      nom: champ(d.get('nom')),
      organisation: champ(d.get('organisation')),
      email: champ(d.get('email')),
      present: d.get('present') === 'on',
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Nom
          <input name="nom" required autoFocus placeholder="M. Bernasconi" />
        </label>
        <label>
          Organisation
          <input name="organisation" placeholder="Bernasconi & Fils SA" />
        </label>
        <label>
          E-mail
          <input name="email" type="email" placeholder="contact@bernasconi.ch" />
        </label>
      </div>
      <label className="case">
        <input name="present" type="checkbox" defaultChecked />
        <span>Présent</span>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Ajouter'}
      </button>
    </form>
  );
}

/** Retirer un participant inscrit par erreur. */
export function RetirerParticipant({
  operationId,
  seanceId,
  participantId,
}: {
  operationId: number;
  seanceId: number;
  participantId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/seances/${seanceId}/participants/${participantId}`,
            undefined,
            'DELETE',
          )
        }
      >
        {enCours ? '…' : 'retirer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

// ---------------------------------------------------------------------
//  Points du PV
// ---------------------------------------------------------------------

/**
 * Ajouter un point au PV.
 *
 * Un point avec **responsable et échéance** devient une action suivie : c'est
 * ce qui remonte dans « actions ouvertes » de l'écran des séances, et ce qui
 * passe en retard tout seul. Sans échéance, le point reste une information.
 */
export function AjouterPoint({
  operationId,
  seanceId,
  ordreSuivant,
}: {
  operationId: number;
  seanceId: number;
  ordreSuivant: number;
}) {
  return (
    <Repliable libelle="Ajouter un point">
      {(fermer) => (
        <FormulairePoint
          operationId={operationId}
          seanceId={seanceId}
          ordreSuivant={ordreSuivant}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulairePoint({
  operationId,
  seanceId,
  ordreSuivant,
  fermer,
}: {
  operationId: number;
  seanceId: number;
  ordreSuivant: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ordre = champ(d.get('ordre'));
    const ok = await envoyer(`/operations/${operationId}/seances/${seanceId}/points`, {
      titre: champ(d.get('titre')),
      ordre: ordre === undefined ? undefined : Number(ordre),
      contenu: champ(d.get('contenu')),
      responsable: champ(d.get('responsable')),
      echeance: champ(d.get('echeance')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Ordre
          <input name="ordre" inputMode="numeric" defaultValue={ordreSuivant} />
        </label>
        <label>
          Titre
          <input name="titre" required autoFocus placeholder="Reprise des joints en façade est" />
        </label>
        <label>
          Responsable
          <input name="responsable" placeholder="Bernasconi & Fils SA" />
        </label>
      </div>
      <div className="grille-2">
        <label>
          Échéance
          <input name="echeance" type="date" />
        </label>
        <label>
          Contenu
          <input name="contenu" placeholder="Constaté en visite du 12.08, à reprendre" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Ajouter le point'}
      </button>
    </form>
  );
}

/** Clore ou rouvrir une action, sans passer par un formulaire. */
export function ChangerStatutPoint({
  operationId,
  seanceId,
  pointId,
  vers,
}: {
  operationId: number;
  seanceId: number;
  pointId: number;
  vers: 'OUVERT' | 'EN_COURS' | 'CLOS';
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const libelle = { OUVERT: 'rouvrir', EN_COURS: 'en cours', CLOS: 'clore' }[vers];

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/seances/${seanceId}/points/${pointId}`,
            { statut: vers },
            'PATCH',
          )
        }
      >
        {enCours ? '…' : libelle}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

// ---------------------------------------------------------------------
//  Tenue et PV
// ---------------------------------------------------------------------

/** Marquer la séance tenue, ou annulée. */
export function ChangerStatutSeance({
  operationId,
  seanceId,
  vers,
}: {
  operationId: number;
  seanceId: number;
  vers: 'TENUE' | 'ANNULEE' | 'PLANIFIEE';
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const libelle = {
    TENUE: 'Marquer tenue',
    ANNULEE: 'Annuler la séance',
    PLANIFIEE: 'Remettre planifiée',
  }[vers];

  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/seances/${seanceId}`, { statut: vers }, 'PATCH')
        }
      >
        {enCours ? '…' : libelle}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Générer le procès-verbal.
 *
 * Le PV est rédigé depuis les points et la feuille de présence, puis
 * **déposé en GED** — il n'est pas un rendu jetable. Le regénérer produit
 * une nouvelle version du même document.
 */
export function GenererPv({ operationId, seanceId }: { operationId: number; seanceId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="principal"
        disabled={enCours}
        onClick={() => void envoyer(`/operations/${operationId}/seances/${seanceId}/pv`, {})}
      >
        {enCours ? 'Rédaction…' : 'Générer le PV'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
