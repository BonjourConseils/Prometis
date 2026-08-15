'use client';

import { type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

export interface CourtierChoisi {
  id: number;
  libelle: string;
}

export interface LotChoisi {
  id: number;
  reference: string;
}

export interface VenteChoisie {
  reservationId: number;
  libelle: string;
}

// ---------------------------------------------------------------------
//  Mandat
// ---------------------------------------------------------------------

/**
 * Signer un mandat de courtage.
 *
 * Deux réglages décident du montant et ne se rattrapent pas après coup :
 *
 *   · **l'assiette** — hors taxe par défaut, comme tout le reste du produit.
 *     Cochée en TTC, la commission se calcule sur le prix majoré de la TVA ;
 *   · **le périmètre** — un mandat sur toute la promotion couvre aussi les
 *     lots créés plus tard. Un mandat sur lots sélectionnés ne couvre que
 *     ceux-là, et une liste vide ne couvre **rien**.
 *
 * L'exclusivité est signalée à la constatation : deux mandats exclusifs sur
 * un même lot sont un conflit, pas une double commission.
 */
export function AjouterMandat({
  operationId,
  courtiers,
  lots,
}: {
  operationId: number;
  courtiers: CourtierChoisi[];
  lots: LotChoisi[];
}) {
  return (
    <Repliable libelle="Signer un mandat">
      {(fermer) => (
        <FormulaireMandat
          operationId={operationId}
          courtiers={courtiers}
          lots={lots}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireMandat({
  operationId,
  courtiers,
  lots,
  fermer,
}: {
  operationId: number;
  courtiers: CourtierChoisi[];
  lots: LotChoisi[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    // Les cases cochées d'un même nom donnent plusieurs valeurs : `getAll`.
    const lotIds = d.getAll('lotIds').map((v) => Number(v));

    const ok = await envoyer(`/operations/${operationId}/courtage/mandats`, {
      courtierActeurId: Number(d.get('courtierActeurId')),
      commissionType: champ(d.get('commissionType')),
      commissionPct: champ(d.get('commissionPct')),
      commissionForfait: champ(d.get('commissionForfait')),
      assietteTtc: d.get('assietteTtc') === 'on',
      perimetre: champ(d.get('perimetre')),
      exclusif: d.get('exclusif') === 'on',
      dateSignature: champ(d.get('dateSignature')),
      notes: champ(d.get('notes')),
      lotIds: lotIds.length > 0 ? lotIds : undefined,
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Courtier
          <select name="courtierActeurId" required defaultValue="">
            <option value="" disabled>
              — choisir —
            </option>
            {courtiers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type de commission
          <select name="commissionType" defaultValue="POURCENTAGE">
            <option value="POURCENTAGE">Pourcentage du prix</option>
            <option value="FORFAIT">Forfait par vente</option>
          </select>
        </label>
        <label>
          Date de signature
          <input name="dateSignature" type="date" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Taux (%)
          <input name="commissionPct" inputMode="decimal" placeholder="3" />
        </label>
        <label>
          Forfait
          <input name="commissionForfait" inputMode="decimal" placeholder="15000" />
        </label>
        <label>
          Périmètre
          <select name="perimetre" defaultValue="TOUTE_OPERATION">
            <option value="TOUTE_OPERATION">Toute la promotion</option>
            <option value="LOTS_SELECTIONNES">Lots sélectionnés</option>
          </select>
        </label>
      </div>
      <p className="note">
        Renseignez le taux <em>ou</em> le forfait, selon le type retenu — un forfait ignore
        l&apos;assiette.
      </p>
      {lots.length > 0 && (
        <fieldset>
          <legend>Lots couverts (si périmètre restreint)</legend>
          <div className="cases-lots">
            {lots.map((l) => (
              <label key={l.id} className="case">
                <input name="lotIds" type="checkbox" value={l.id} />
                <span>{l.reference}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="case">
        <input name="assietteTtc" type="checkbox" />
        <span>
          Commission assise sur le prix TTC
          <span className="meta">
            Par défaut hors taxe, comme partout ailleurs dans le produit.
          </span>
        </span>
      </label>
      <label className="case">
        <input name="exclusif" type="checkbox" />
        <span>
          Mandat exclusif
          <span className="meta">
            Un second mandat exclusif sur les mêmes lots sera signalé en conflit.
          </span>
        </span>
      </label>
      <label>
        Notes
        <input name="notes" placeholder="Mandat de six mois, reconductible" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le mandat'}
      </button>
    </form>
  );
}

/** Faire vivre le mandat : signé, actif, terminé, résilié. */
export function ChangerStatutMandat({
  operationId,
  mandatId,
  vers,
}: {
  operationId: number;
  mandatId: number;
  vers: 'SIGNE' | 'ACTIF' | 'TERMINE' | 'RESILIE';
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const libelle = {
    SIGNE: 'Signer',
    ACTIF: 'Activer',
    TERMINE: 'Terminer',
    RESILIE: 'Résilier',
  }[vers];

  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/courtage/mandats/${mandatId}/statut`,
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
//  Commissions
// ---------------------------------------------------------------------

/**
 * Constater les commissions dues sur une vente.
 *
 * Le calcul est fait par l'API depuis les mandats qui couvrent le lot : rien
 * n'est saisi à la main. L'opération est idempotente — une commission déjà
 * constatée pour un couple (mandat, réservation) est signalée comme ignorée
 * plutôt que recréée.
 */
export function ConstaterCommissions({
  operationId,
  ventes,
}: {
  operationId: number;
  ventes: VenteChoisie[];
}) {
  return (
    <Repliable libelle="Constater les commissions d'une vente">
      {(fermer) => (
        <FormulaireConstatation operationId={operationId} ventes={ventes} fermer={fermer} />
      )}
    </Repliable>
  );
}

function FormulaireConstatation({
  operationId,
  ventes,
  fermer,
}: {
  operationId: number;
  ventes: VenteChoisie[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/courtage/reservations/${Number(d.get('reservationId'))}/commissions`,
      {},
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Vente
        <select name="reservationId" required defaultValue="">
          <option value="" disabled>
            — choisir —
          </option>
          {ventes.map((v) => (
            <option key={v.reservationId} value={v.reservationId}>
              {v.libelle}
            </option>
          ))}
        </select>
      </label>
      {ventes.length === 0 && (
        <p className="note">Aucune réservation sur cette promotion : rien à commissionner.</p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours || ventes.length === 0}>
        {enCours ? 'Calcul…' : 'Constater'}
      </button>
    </form>
  );
}

/** Suivre le règlement d'une commission : due → facturée → payée. */
export function ChangerStatutCommission({
  operationId,
  commissionId,
  vers,
}: {
  operationId: number;
  commissionId: number;
  vers: 'DUE' | 'FACTUREE' | 'PAYEE' | 'ANNULEE';
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const libelle = {
    DUE: 'Remettre due',
    FACTUREE: 'Facturée',
    PAYEE: 'Payée',
    ANNULEE: 'Annuler',
  }[vers];

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/courtage/commissions/${commissionId}`,
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
