'use client';

import { type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

interface Poste {
  id: number;
  code: string;
  libelle: string;
}

/**
 * Les postes CFC dans une liste déroulante.
 *
 * Pas d'indentation par espaces : elle casserait la recherche au clavier,
 * qui compare depuis le premier caractère. Sur soixante-neuf postes, taper
 * « 211 » est le geste utile — et la hiérarchie se lit déjà dans le code,
 * c'est à cela que sert la numérotation CFC.
 */
function OptionsPostes({ postes }: { postes: Poste[] }) {
  return (
    <>
      {postes.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} · {p.libelle}
        </option>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------
//  Soumission
// ---------------------------------------------------------------------

export function AjouterSoumission({
  operationId,
  postes,
}: {
  operationId: number;
  postes: Poste[];
}) {
  return (
    <Repliable libelle="Lancer un appel d'offres">
      {(fermer) => (
        <FormulaireSoumission operationId={operationId} postes={postes} fermer={fermer} />
      )}
    </Repliable>
  );
}

function FormulaireSoumission({
  operationId,
  postes,
  fermer,
}: {
  operationId: number;
  postes: Poste[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const poste = champ(d.get('cfcNodeId'));
    const ok = await envoyer(`/operations/${operationId}/soumissions`, {
      intitule: champ(d.get('intitule')),
      corpsMetier: champ(d.get('corpsMetier')),
      cfcNodeId: poste === undefined ? undefined : Number(poste),
      dateLimite: champ(d.get('dateLimite')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Le <strong>poste CFC</strong> est ce qui rattache l&apos;appel d&apos;offres au budget :
        sans lui, la comparaison ne saura pas à quel montant budgété confronter les offres, et
        l&apos;adjudication ne remplira aucune colonne « adjugé ».
      </p>
      <div className="grille-3">
        <label>
          Intitulé
          <input name="intitule" required autoFocus placeholder="Maçonnerie et béton armé" />
        </label>
        <label>
          Corps de métier
          <input name="corpsMetier" placeholder="Maçonnerie" />
        </label>
        <label>
          Délai de remise
          <input name="dateLimite" type="date" />
        </label>
      </div>
      <label>
        Poste CFC
        <select name="cfcNodeId" defaultValue="">
          <option value="">— non rattachée —</option>
          <OptionsPostes postes={postes} />
        </select>
      </label>
      {postes.length === 0 && (
        <p className="note">
          Aucun poste CFC sur cette promotion. Chiffrez le budget d&apos;abord : les offres se
          comparent à un budget, pas à rien.
        </p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Créer l'appel d'offres"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Entreprise (répertoire de la société)
// ---------------------------------------------------------------------

/**
 * Le répertoire est au niveau de la **société**, pas de la promotion : une
 * entreprise soumissionne sur plusieurs chantiers, et son historique d'offres
 * n'a d'intérêt que s'il les traverse.
 */
export function AjouterEntreprise() {
  return (
    <Repliable libelle="Ajouter une entreprise">
      {(fermer) => <FormulaireEntreprise fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireEntreprise({ fermer }: { fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer('/entreprises', {
      nom: champ(d.get('nom')),
      corpsMetier: champ(d.get('corpsMetier')),
      contactNom: champ(d.get('contactNom')),
      email: champ(d.get('email')),
      telephone: champ(d.get('telephone')),
      ide: champ(d.get('ide')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Raison sociale
          <input name="nom" required autoFocus placeholder="Bernasconi & Fils SA" />
        </label>
        <label>
          Corps de métier
          <input name="corpsMetier" placeholder="Maçonnerie" />
        </label>
        <label>
          N° IDE
          <input name="ide" placeholder="CHE-123.456.789" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Contact
          <input name="contactNom" placeholder="M. Bernasconi" />
        </label>
        <label>
          E-mail
          <input name="email" type="email" placeholder="contact@bernasconi.ch" />
        </label>
        <label>
          Téléphone
          <input name="telephone" placeholder="021 000 00 00" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'entreprise"}
      </button>
    </form>
  );
}
