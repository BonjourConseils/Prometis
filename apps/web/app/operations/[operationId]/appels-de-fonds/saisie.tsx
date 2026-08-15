'use client';

import { type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

// ---------------------------------------------------------------------
//  Échéancier
// ---------------------------------------------------------------------

/**
 * Ajouter un jalon à l'échéancier.
 *
 * Le `pourcentage` est **facultatif**, et c'est la distinction structurante :
 * un jalon avec pourcentage appelle des fonds, un jalon sans pourcentage
 * n'est qu'un repère de chantier. La somme des pourcentages doit faire 100 %,
 * sinon une part du prix ne sera jamais appelée — l'écran l'affiche en
 * permanence plutôt que de le refuser à la saisie, parce qu'un échéancier se
 * construit jalon par jalon et passe forcément par des états incomplets.
 */
export function AjouterEtape({
  operationId,
  ordreSuivant,
  restant,
}: {
  operationId: number;
  ordreSuivant: number;
  restant: string;
}) {
  return (
    <Repliable libelle="Ajouter un jalon">
      {(fermer) => (
        <FormulaireEtape
          operationId={operationId}
          ordreSuivant={ordreSuivant}
          restant={restant}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireEtape({
  operationId,
  ordreSuivant,
  restant,
  fermer,
}: {
  operationId: number;
  ordreSuivant: number;
  restant: string;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/echeancier`, {
      ordre: Number(d.get('ordre')),
      libelle: champ(d.get('libelle')),
      description: champ(d.get('description')),
      pourcentage: champ(d.get('pourcentage')),
      datePrevue: champ(d.get('datePrevue')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Laisser le pourcentage vide fait un <strong>jalon de suivi</strong> : il marque
        l&apos;avancement du chantier sans appeler de fonds. Il reste {restant} à répartir pour
        couvrir 100 % du prix.
      </p>
      <div className="grille-3">
        <label>
          Ordre
          <input name="ordre" required inputMode="numeric" defaultValue={ordreSuivant} />
        </label>
        <label>
          Jalon
          <input name="libelle" required autoFocus placeholder="Fin du gros œuvre" />
        </label>
        <label>
          Pourcentage
          <input name="pourcentage" inputMode="decimal" placeholder="15" />
        </label>
      </div>
      <div className="grille-2">
        <label>
          Date prévue
          <input name="datePrevue" type="date" />
        </label>
        <label>
          Description
          <input name="description" placeholder="Dalle du dernier niveau coulée" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le jalon'}
      </button>
    </form>
  );
}

/** Marquer un jalon en cours, ou revenir en arrière. */
export function ChangerAvancement({
  operationId,
  etapeId,
  vers,
}: {
  operationId: number;
  etapeId: number;
  vers: 'NOT_STARTED' | 'IN_PROGRESS';
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/echeancier/${etapeId}/avancement`, {
            statut: vers,
          })
        }
      >
        {enCours ? '…' : vers === 'IN_PROGRESS' ? 'Démarrer' : 'Remettre à venir'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

// ---------------------------------------------------------------------
//  Le moteur
// ---------------------------------------------------------------------

/**
 * Marquer un jalon terminé et générer les appels de fonds.
 *
 * C'est le geste le plus engageant du produit : il facture d'un coup tous les
 * acquéreurs engagés de la promotion, PDF et QR-facture compris. Le formulaire
 * annonce donc le nombre de réservations concernées **avant** l'envoi, et
 * l'envoi des e-mails est une case à cocher, pas un effet de bord.
 *
 * L'opération est idempotente : l'unicité `(reservationId, etapeId)` fait
 * qu'un déclenchement rejoué ne crée pas une seconde créance.
 */
export function DeclencherEtape({
  operationId,
  etapeId,
  libelle,
  pourcentage,
  nombreEngagees,
}: {
  operationId: number;
  etapeId: number;
  libelle: string;
  pourcentage: string;
  nombreEngagees: number;
}) {
  return (
    <Repliable libelle="Déclencher">
      {(fermer) => (
        <FormulaireDeclenchement
          operationId={operationId}
          etapeId={etapeId}
          libelle={libelle}
          pourcentage={pourcentage}
          nombreEngagees={nombreEngagees}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireDeclenchement({
  operationId,
  etapeId,
  libelle,
  pourcentage,
  nombreEngagees,
  fermer,
}: {
  operationId: number;
  etapeId: number;
  libelle: string;
  pourcentage: string;
  nombreEngagees: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/echeancier/${etapeId}/declencher`, {
      dateCompletion: champ(d.get('dateCompletion')),
      envoyer: d.get('envoyer') === 'on',
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Marquer « {libelle} » terminé génère un appel de fonds de {pourcentage} du prix total acte
        pour <strong>{nombreEngagees}</strong> réservation
        {nombreEngagees > 1 ? 's engagées' : ' engagée'}. Rejouer l&apos;opération ne crée aucune
        créance en double.
      </p>
      <div className="grille-2">
        <label>
          Date de complétion
          <input name="dateCompletion" type="date" />
        </label>
      </div>
      <label className="case">
        <input name="envoyer" type="checkbox" defaultChecked />
        <span>
          Envoyer les appels aux acquéreurs
          <span className="meta">
            Décocher pour générer sans envoyer — utile en reprise de données.
          </span>
        </span>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours || nombreEngagees === 0}>
        {enCours ? 'Génération…' : 'Marquer terminé et générer'}
      </button>
      {nombreEngagees === 0 && (
        <p className="note">
          Aucune réservation engagée : il n&apos;y a rien à appeler. Une réservation en option ne
          compte pas.
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------
//  Encaissements et relances
// ---------------------------------------------------------------------

/**
 * Enregistrer un encaissement.
 *
 * Le solde est pré-rempli, mais modifiable : un acquéreur qui verse un
 * montant rond, ou en deux fois, est le cas courant. C'est le cumul des
 * encaissements qui solde l'appel, pas un statut posé à la main.
 */
export function Encaisser({
  operationId,
  appelId,
  solde,
}: {
  operationId: number;
  appelId: number;
  solde: string;
}) {
  return (
    <Repliable libelle="Encaisser">
      {(fermer) => (
        <FormulaireEncaissement
          operationId={operationId}
          appelId={appelId}
          solde={solde}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireEncaissement({
  operationId,
  appelId,
  solde,
  fermer,
}: {
  operationId: number;
  appelId: number;
  solde: string;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/appels-de-fonds/${appelId}/encaissements`,
      {
        montant: champ(d.get('montant')),
        dateValeur: champ(d.get('dateValeur')),
        reference: champ(d.get('reference')),
        source: champ(d.get('source')),
      },
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Montant
          <input name="montant" required autoFocus inputMode="decimal" defaultValue={solde} />
        </label>
        <label>
          Date de valeur
          <input name="dateValeur" type="date" required />
        </label>
        <label>
          Source
          <select name="source" defaultValue="MANUEL">
            <option value="MANUEL">Saisie manuelle</option>
            <option value="CAMT054">Fichier camt.054</option>
          </select>
        </label>
      </div>
      <label>
        Référence
        <input name="reference" placeholder="Référence QR de l'avis de crédit" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'encaissement"}
      </button>
    </form>
  );
}

/** Relancer un appel impayé — un e-mail part, avec la QR-facture. */
export function Relancer({ operationId, appelId }: { operationId: number; appelId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/appels-de-fonds/${appelId}/relance`, {})
        }
      >
        {enCours ? 'Envoi…' : 'Relancer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
