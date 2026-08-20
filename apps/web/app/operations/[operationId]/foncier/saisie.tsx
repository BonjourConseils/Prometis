'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { nombre } from '../../../../lib/format';
import { Repliable, useEnvoi } from '../../../components/formulaire';

/**
 * Formulaires de saisie du foncier.
 *
 * Un seul composant client pour les quatre niveaux — parcelle, bien, lot,
 * place de parc — parce qu'ils partagent la même mécanique : un formulaire
 * replié, un envoi, un rafraîchissement du rendu serveur. Les séparer
 * dupliquerait quatre fois la gestion d'erreur pour quatre champs de
 * différence.
 *
 * Après création, `router.refresh()` : c'est le serveur qui relit la liste,
 * donc l'écran montre ce que la base contient réellement — pas un état
 * local qu'on croirait à jour.
 */
// ---------------------------------------------------------------------
//  Parcelle
// ---------------------------------------------------------------------

export function AjouterParcelle({ operationId }: { operationId: number }) {
  return (
    <Repliable libelle="Ajouter une parcelle">
      {(fermer) => <FormulaireParcelle operationId={operationId} fermer={fermer} />}
    </Repliable>
  );
}

/**
 * Modifier une parcelle déjà saisie.
 *
 * Le même formulaire que la création, pré-rempli : une surface corrigée ou un
 * prix négocié à la baisse ne doit pas obliger à tout resaisir.
 */
export function ModifierParcelle({
  operationId,
  parcelle,
}: {
  operationId: number;
  parcelle: ParcelleExistante;
}) {
  return (
    <Repliable libelle="Modifier">
      {(fermer) => (
        <FormulaireParcelle operationId={operationId} parcelle={parcelle} fermer={fermer} />
      )}
    </Repliable>
  );
}

export interface ParcelleExistante {
  id: number;
  numero: string;
  egrid: string | null;
  commune: string | null;
  surfaceM2: string | null;
  affectationZone: string | null;
  registreFoncier: string | null;
  lienGeoportail: string | null;
  lienRdppf: string | null;
  prixAchat: string | null;
  ibus: string | null;
}

function FormulaireParcelle({
  operationId,
  parcelle,
  fermer,
}: {
  operationId: number;
  parcelle?: ParcelleExistante;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  // Ce que la parcelle vaut au m² et ce qu'on peut y bâtir : deux chiffres
  // qui décident d'un achat, et qu'on veut voir bouger pendant qu'on négocie.
  const [surface, setSurface] = useState(parcelle?.surfaceM2 ?? '');
  const [prix, setPrix] = useState(parcelle?.prixAchat ?? '');
  const [ibus, setIbus] = useState(parcelle?.ibus ?? '');

  const nb = (v: string) => {
    const n = Number(v.replace(/[\s'\u2019]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const prixM2 = nb(surface) > 0 ? nb(prix) / nb(surface) : 0;
  const sbp = nb(surface) * nb(ibus);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const corps = {
      numero: champ(d.get('numero')),
      egrid: champ(d.get('egrid')),
      commune: champ(d.get('commune')),
      surfaceM2: champ(d.get('surfaceM2')),
      affectationZone: champ(d.get('affectationZone')),
      registreFoncier: champ(d.get('registreFoncier')),
      lienGeoportail: champ(d.get('lienGeoportail')),
      lienRdppf: champ(d.get('lienRdppf')),
      prixAchat: champ(d.get('prixAchat')),
      ibus: champ(d.get('ibus')),
    };
    const ok = parcelle
      ? await envoyer(`/operations/${operationId}/parcelles/${parcelle.id}`, corps, 'PATCH')
      : await envoyer(`/operations/${operationId}/parcelles`, corps);
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Numéro
          <input
            name="numero"
            required
            autoFocus
            defaultValue={parcelle?.numero ?? ''}
            placeholder="2841"
          />
        </label>
        <label>
          Commune
          <input name="commune" defaultValue={parcelle?.commune ?? ''} placeholder="Prilly" />
        </label>
        <label>
          Surface (m²)
          <input
            name="surfaceM2"
            inputMode="decimal"
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            placeholder="2480"
          />
        </label>
      </div>
      <div className="grille-3">
        <label>
          E-GRID
          <input name="egrid" defaultValue={parcelle?.egrid ?? ''} placeholder="CH807361283946" />
        </label>
        <label>
          Zone d&apos;affectation
          <input
            name="affectationZone"
            defaultValue={parcelle?.affectationZone ?? ''}
            placeholder="Zone de moyenne densité"
          />
        </label>
        <label>
          Registre foncier
          <input
            name="registreFoncier"
            defaultValue={parcelle?.registreFoncier ?? ''}
            placeholder="RF Lausanne"
          />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Prix d&apos;achat
          <input
            name="prixAchat"
            inputMode="decimal"
            value={prix}
            onChange={(e) => setPrix(e.target.value)}
            placeholder="1850000"
          />
        </label>
        <label>
          IBUS
          <input
            name="ibus"
            inputMode="decimal"
            value={ibus}
            onChange={(e) => setIbus(e.target.value)}
            placeholder="0.6"
          />
        </label>
      </div>
      <div className="grille-2">
        <label>
          Lien géoportail
          <input
            name="lienGeoportail"
            type="url"
            defaultValue={parcelle?.lienGeoportail ?? ''}
            placeholder="https://maps.mongeometre.ch/?…"
          />
        </label>
        <label>
          Extrait RDPPF
          <input
            name="lienRdppf"
            type="url"
            defaultValue={parcelle?.lienRdppf ?? ''}
            placeholder="https://rdppf.apps.vs.ch/extract/pdf?…"
          />
        </label>
      </div>

      {(prixM2 > 0 || sbp > 0) && (
        <p className="note">
          {prixM2 > 0 && (
            <>
              <strong>{nombre(prixM2.toFixed(2), 'CHF/m²')}</strong> de terrain
              {sbp > 0 ? ' · ' : '.'}
            </>
          )}
          {sbp > 0 && (
            <>
              <strong>{nombre(sbp.toFixed(0), 'm²')}</strong> de surface brute de plancher
              constructible ({nombre(surface, 'm²')} × {ibus}).
            </>
          )}
        </p>
      )}

      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : parcelle ? 'Enregistrer' : 'Enregistrer la parcelle'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Bien
// ---------------------------------------------------------------------

export function AjouterBien({ operationId }: { operationId: number }) {
  return (
    <Repliable libelle="Ajouter un bien">
      {(fermer) => <FormulaireBien operationId={operationId} fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireBien({ operationId, fermer }: { operationId: number; fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const etages = champ(d.get('nbEtages'));
    const ok = await envoyer(`/operations/${operationId}/biens`, {
      nom: champ(d.get('nom')),
      nature: champ(d.get('nature')),
      // `nbEtages` est un entier côté API : une chaîne serait refusée.
      nbEtages: etages === undefined ? undefined : Number(etages),
      description: champ(d.get('description')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Nom
          <input name="nom" required autoFocus placeholder="Immeuble A" />
        </label>
        <label>
          Nature
          <select name="nature" defaultValue="IMMEUBLE">
            <option value="IMMEUBLE">Immeuble</option>
            <option value="VILLA">Villa</option>
            <option value="CHALET">Chalet</option>
            <option value="LOTISSEMENT">Lotissement</option>
          </select>
        </label>
        <label>
          Nombre d&apos;étages
          <input name="nbEtages" inputMode="numeric" placeholder="5" />
        </label>
      </div>
      <label>
        Description
        <input name="description" placeholder="12 lots PPE, attique en 4e" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le bien'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Lot
// ---------------------------------------------------------------------

export function AjouterLot({ operationId, bienId }: { operationId: number; bienId: number }) {
  return (
    <Repliable libelle="Ajouter un lot">
      {(fermer) => <FormulaireLot operationId={operationId} bienId={bienId} fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireLot({
  operationId,
  bienId,
  fermer,
}: {
  operationId: number;
  bienId: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const etage = champ(d.get('etage'));
    const ok = await envoyer(`/operations/${operationId}/biens/${bienId}/lots`, {
      reference: champ(d.get('reference')),
      etage: etage === undefined ? undefined : Number(etage),
      nombrePieces: champ(d.get('nombrePieces')),
      surfaceM2: champ(d.get('surfaceM2')),
      quotePartPPE: champ(d.get('quotePartPPE')),
      // Les montants restent des CHAÎNES jusqu'au Decimal côté serveur.
      prixVente: champ(d.get('prixVente')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Référence
          <input name="reference" required autoFocus placeholder="A02" />
        </label>
        <label>
          Étage
          <input name="etage" inputMode="numeric" placeholder="0" />
        </label>
        <label>
          Pièces
          <input name="nombrePieces" inputMode="decimal" placeholder="4.5" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Surface (m²)
          <input name="surfaceM2" inputMode="decimal" placeholder="102" />
        </label>
        <label>
          Quote-part PPE (‰)
          <input name="quotePartPPE" inputMode="decimal" placeholder="52" />
        </label>
        <label>
          Prix de vente
          <input name="prixVente" inputMode="decimal" placeholder="815000" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le lot'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Place de parc
// ---------------------------------------------------------------------

export function AjouterParking({
  operationId,
  lotId,
  referenceLot,
}: {
  operationId: number;
  lotId: number;
  referenceLot: string;
}) {
  return (
    <Repliable libelle="+ parc">
      {(fermer) => (
        <FormulaireParking
          operationId={operationId}
          lotId={lotId}
          referenceLot={referenceLot}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireParking({
  operationId,
  lotId,
  referenceLot,
  fermer,
}: {
  operationId: number;
  lotId: number;
  referenceLot: string;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/lots/${lotId}/parkings`, {
      reference: champ(d.get('reference')),
      type: champ(d.get('type')),
      prix: champ(d.get('prix')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Le prix de la place s&apos;ajoute à celui du lot pour former le{' '}
        <strong>prix total acte</strong> — l&apos;assiette des appels de fonds du lot {referenceLot}
        .
      </p>
      <div className="grille-3">
        <label>
          Référence
          <input name="reference" autoFocus placeholder="BOX-A02" />
        </label>
        <label>
          Type
          <select name="type" defaultValue="INTERIEURE">
            <option value="INTERIEURE">Intérieure</option>
            <option value="BOX">Box</option>
            <option value="COUVERTE">Couverte</option>
            <option value="EXTERIEURE">Extérieure</option>
            <option value="AUTRE">Autre</option>
          </select>
        </label>
        <label>
          Prix
          <input name="prix" inputMode="decimal" placeholder="35000" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer la place'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Découpages de parcelle — zones et degrés de sensibilité
// ---------------------------------------------------------------------

const TYPES_DECOUPAGE: [string, string][] = [
  ['ZONE_AFFECTATION', "Zone d'affectation"],
  ['DEGRE_SENSIBILITE_BRUIT', 'Degré de sensibilité au bruit'],
  ['AUTRE', 'Autre thème RDPPF'],
];

/**
 * Ajoute une part de parcelle.
 *
 * Une parcelle n'est pas homogène : elle porte souvent deux zones et deux
 * degrés de sensibilité, chacun sur une fraction de sa surface. Les valeurs
 * se recopient de l'extrait RDPPF telles quelles — surface ET pourcentage,
 * sans recalculer l'un depuis l'autre : les deux figurent au document et
 * peuvent différer d'un arrondi.
 */
export function AjouterDecoupage({
  operationId,
  parcelleId,
  numero,
}: {
  operationId: number;
  parcelleId: number;
  numero: string;
}) {
  return (
    <Repliable libelle="Ajouter une zone ou un degré">
      {(fermer) => (
        <FormulaireDecoupage
          operationId={operationId}
          parcelleId={parcelleId}
          numero={numero}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireDecoupage({
  operationId,
  parcelleId,
  numero,
  fermer,
}: {
  operationId: number;
  parcelleId: number;
  numero: string;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/parcelles/${parcelleId}/decoupages`, {
      type: champ(d.get('type')),
      libelle: champ(d.get('libelle')),
      surfaceM2: champ(d.get('surfaceM2')),
      pourcentage: champ(d.get('pourcentage')),
      ibus: champ(d.get('ibus')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Parcelle <strong>{numero}</strong>. Recopiez la ligne de l&apos;extrait RDPPF telle
        qu&apos;elle apparaît.
      </p>
      <div className="grille-2">
        <label>
          Thème
          <select name="type" defaultValue="ZONE_AFFECTATION">
            {TYPES_DECOUPAGE.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Désignation
          <input name="libelle" required autoFocus placeholder="Zone d'habitat collectif B (3)" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Surface (m²)
          <input name="surfaceM2" inputMode="decimal" placeholder="1706" />
        </label>
        <label>
          Part (%)
          <input name="pourcentage" inputMode="decimal" placeholder="100" />
        </label>
        <label>
          IBUS de la zone
          <input name="ibus" inputMode="decimal" placeholder="0.6" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Ajouter'}
      </button>
    </form>
  );
}

/** Retire une part saisie par erreur. */
export function SupprimerDecoupage({
  operationId,
  decoupageId,
}: {
  operationId: number;
  decoupageId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/decoupages/${decoupageId}`, undefined, 'DELETE')
        }
      >
        {enCours ? '…' : 'retirer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
