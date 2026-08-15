'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { appelApi, champ } from '../../../../lib/api-client';

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
function Repliable({
  libelle,
  children,
}: {
  libelle: string;
  children: (fermer: () => void) => ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        {libelle}
      </button>
    );
  }
  return (
    <div className="saisie">
      {children(() => setOuvert(false))}
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}

function useEnvoi(fermer: () => void) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const envoyer = async (chemin: string, corps: unknown) => {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi(chemin, { methode: 'POST', corps });
    setEnCours(false);

    if (!res.ok) {
      setErreur(res.erreur ?? 'Création impossible.');
      return;
    }
    fermer();
    router.refresh();
  };

  return { envoyer, erreur, enCours };
}

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

function FormulaireParcelle({ operationId, fermer }: { operationId: number; fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi(fermer);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(`/operations/${operationId}/parcelles`, {
      numero: champ(d.get('numero')),
      egrid: champ(d.get('egrid')),
      commune: champ(d.get('commune')),
      surfaceM2: champ(d.get('surfaceM2')),
      affectationZone: champ(d.get('affectationZone')),
      registreFoncier: champ(d.get('registreFoncier')),
    });
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Numéro
          <input name="numero" required autoFocus placeholder="2841" />
        </label>
        <label>
          Commune
          <input name="commune" placeholder="Prilly" />
        </label>
        <label>
          Surface (m²)
          <input name="surfaceM2" inputMode="decimal" placeholder="2480" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          E-GRID
          <input name="egrid" placeholder="CH807361283946" />
        </label>
        <label>
          Zone d&apos;affectation
          <input name="affectationZone" placeholder="Zone de moyenne densité" />
        </label>
        <label>
          Registre foncier
          <input name="registreFoncier" placeholder="RF Lausanne" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer la parcelle'}
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
  const { envoyer, erreur, enCours } = useEnvoi(fermer);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const etages = champ(d.get('nbEtages'));
    await envoyer(`/operations/${operationId}/biens`, {
      nom: champ(d.get('nom')),
      nature: champ(d.get('nature')),
      // `nbEtages` est un entier côté API : une chaîne serait refusée.
      nbEtages: etages === undefined ? undefined : Number(etages),
      description: champ(d.get('description')),
    });
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
  const { envoyer, erreur, enCours } = useEnvoi(fermer);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const etage = champ(d.get('etage'));
    await envoyer(`/operations/${operationId}/biens/${bienId}/lots`, {
      reference: champ(d.get('reference')),
      etage: etage === undefined ? undefined : Number(etage),
      nombrePieces: champ(d.get('nombrePieces')),
      surfaceM2: champ(d.get('surfaceM2')),
      quotePartPPE: champ(d.get('quotePartPPE')),
      // Les montants restent des CHAÎNES jusqu'au Decimal côté serveur.
      prixVente: champ(d.get('prixVente')),
    });
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
  const { envoyer, erreur, enCours } = useEnvoi(fermer);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    await envoyer(`/operations/${operationId}/lots/${lotId}/parkings`, {
      reference: champ(d.get('reference')),
      type: champ(d.get('type')),
      prix: champ(d.get('prix')),
    });
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
