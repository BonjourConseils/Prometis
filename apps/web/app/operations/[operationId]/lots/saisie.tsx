'use client';

import { type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { nomAcquereur } from '../../../../lib/format';
import { Repliable, useEnvoi } from '../../../components/formulaire';

export interface AcquereurChoisi {
  id: number;
  nom: string | null;
  prenom: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------
//  Acquéreur
// ---------------------------------------------------------------------

/**
 * Le répertoire des acquéreurs est au niveau de la **société** : un même
 * acquéreur peut acheter sur deux promotions, et son adresse ne se resaisit
 * pas. C'est aussi lui qui portera l'accès au portail acquéreur en V2.
 */
export function AjouterAcquereur() {
  return (
    <Repliable libelle="Ajouter un acquéreur">
      {(fermer) => <FormulaireAcquereur fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireAcquereur({ fermer }: { fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer('/acquereurs', {
      prenom: champ(d.get('prenom')),
      nom: champ(d.get('nom')),
      email: champ(d.get('email')),
      telephone: champ(d.get('telephone')),
      adresse: champ(d.get('adresse')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        L&apos;<strong>adresse</strong> et l&apos;<strong>e-mail</strong> ne sont pas du confort :
        l&apos;adresse figure sur la QR-facture des appels de fonds, l&apos;e-mail est la voie
        d&apos;envoi. Sans eux, l&apos;appel de fonds ne pourra pas partir.
      </p>
      <div className="grille-3">
        <label>
          Prénom
          <input name="prenom" autoFocus placeholder="Marie" />
        </label>
        <label>
          Nom
          <input name="nom" placeholder="Dupont" />
        </label>
        <label>
          E-mail
          <input name="email" type="email" placeholder="marie.dupont@example.ch" />
        </label>
      </div>
      <div className="grille-2">
        <label>
          Adresse
          <input name="adresse" placeholder="Rue du Lac 12, 1007 Lausanne" />
        </label>
        <label>
          Téléphone
          <input name="telephone" placeholder="079 000 00 00" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'acquéreur"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Réservation
// ---------------------------------------------------------------------

/**
 * Réserver un lot.
 *
 * Le **prix total acte** n'est pas saisi : l'API le calcule (prix du lot +
 * Σ places de parc) puis le **fige** dans la réservation. C'est lui, et non
 * le prix courant du lot, qui servira d'assiette à tous les appels de fonds —
 * un prix catalogue qui bouge après la vente ne doit rien changer aux appels
 * déjà partis.
 */
export function ReserverLot({
  operationId,
  lotId,
  referenceLot,
  acquereurs,
}: {
  operationId: number;
  lotId: number;
  referenceLot: string;
  acquereurs: AcquereurChoisi[];
}) {
  return (
    <Repliable libelle="Réserver">
      {(fermer) => (
        <FormulaireReservation
          operationId={operationId}
          lotId={lotId}
          referenceLot={referenceLot}
          acquereurs={acquereurs}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireReservation({
  operationId,
  lotId,
  referenceLot,
  acquereurs,
  fermer,
}: {
  operationId: number;
  lotId: number;
  referenceLot: string;
  acquereurs: AcquereurChoisi[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/reservations`, {
      lotId,
      acquereurId: Number(d.get('acquereurId')),
      statut: champ(d.get('statut')),
      dateReservation: champ(d.get('dateReservation')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Lot <strong>{referenceLot}</strong>. Le prix total acte est calculé et figé à cet instant :
        prix du lot + places de parc. Une réservation en <strong>option</strong> n&apos;appelle
        aucun fonds — seuls les statuts réservé, fonds versés et vendu sont engagés.
      </p>
      <div className="grille-3">
        <label>
          Acquéreur
          <select name="acquereurId" required defaultValue="">
            <option value="" disabled>
              — choisir —
            </option>
            {acquereurs.map((a) => (
              <option key={a.id} value={a.id}>
                {nomAcquereur(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Statut
          <select name="statut" defaultValue="OPTION">
            <option value="OPTION">Option</option>
            <option value="RESERVE">Réservé</option>
            <option value="VENDU">Vendu</option>
          </select>
        </label>
        <label>
          Date
          <input name="dateReservation" type="date" />
        </label>
      </div>
      {acquereurs.length === 0 && (
        <p className="note">Le répertoire est vide : ajoutez l&apos;acquéreur d&apos;abord.</p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer la réservation'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Suite de la vente
// ---------------------------------------------------------------------

/**
 * Faire avancer une réservation : signature de l'acte, annulation.
 *
 * La date de signature est ce qui déclenche, lot par lot, la première étape
 * de l'échéancier — les suivantes sont des jalons de chantier communs.
 */
export function AvancerReservation({
  operationId,
  reservationId,
  statut,
}: {
  operationId: number;
  reservationId: number;
  statut: string;
}) {
  return (
    <Repliable libelle="Modifier">
      {(fermer) => (
        <FormulaireAvancement
          operationId={operationId}
          reservationId={reservationId}
          statut={statut}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireAvancement({
  operationId,
  reservationId,
  statut,
  fermer,
}: {
  operationId: number;
  reservationId: number;
  statut: string;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/reservations/${reservationId}`,
      {
        statut: champ(d.get('statut')),
        dateSignatureActe: champ(d.get('dateSignatureActe')),
      },
      'PATCH',
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-2">
        <label>
          Statut
          <select name="statut" defaultValue={statut}>
            <option value="OPTION">Option</option>
            <option value="RESERVE">Réservé</option>
            <option value="FONDS_VERSES">Fonds versés</option>
            <option value="VENDU">Vendu</option>
            <option value="EXPIREE">Expirée</option>
            <option value="ANNULEE">Annulée</option>
          </select>
        </label>
        <label>
          Signature de l&apos;acte
          <input name="dateSignatureActe" type="date" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}
