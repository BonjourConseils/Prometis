'use client';

import { useState, type FormEvent } from 'react';
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
  /**
   * **Le poste CFC d'abord.** C'est l'inversion qui cadre tout le reste.
   *
   * Avant, l'intitulé, le corps de métier et le poste se saisissaient
   * librement : on pouvait demander « Maçonnerie » en « Peinture » sur le
   * poste « Ferblanterie ». Trois champs qui se contredisent, et c'est
   * l'écart budgété / adjugé qui en paie le prix.
   *
   * Maintenant on choisit le poste, l'intitulé en hérite, et le corps de
   * métier **se déduit** du libellé CFC : l'app le connaît, elle ne le
   * demande pas.
   */
  const [poste, setPoste] = useState('');
  const [intitule, setIntitule] = useState('');
  const choisi = postes.find((p) => String(p.id) === poste) ?? null;

  function choisirPoste(valeur: string) {
    setPoste(valeur);
    const p = postes.find((x) => String(x.id) === valeur);
    // L'intitulé commence par le libellé du poste, et reste complétable :
    // « Plâtrerie — étages 1 à 4 ». On ne réécrit pas ce que l'utilisateur
    // a déjà tapé au-delà du libellé précédent.
    if (p) setIntitule((avant) => (avant.trim() === '' ? p.libelle : avant));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/soumissions`, {
      intitule: champ(d.get('intitule')),
      // Déduit du poste, jamais saisi : deux champs qui doivent s'accorder
      // finissent toujours par diverger.
      corpsMetier: choisi?.libelle ?? null,
      cfcNodeId: poste === '' ? undefined : Number(poste),
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
      <label>
        Poste CFC du budget
        <select
          name="cfcNodeId"
          required
          value={poste}
          onChange={(e) => choisirPoste(e.target.value)}
          autoFocus
        >
          <option value="">— choisir le poste —</option>
          <OptionsPostes postes={postes} />
        </select>
      </label>

      {choisi && (
        <div className="grille-3">
          <label>
            Intitulé
            <input
              name="intitule"
              required
              value={intitule}
              onChange={(e) => setIntitule(e.target.value)}
            />
          </label>
          <label>
            Corps de métier
            {/* Déduit du poste : l'app le connaît. En faire un champ libre,
                c'était inviter « Peinture » sur un poste de ferblanterie. */}
            <input value={choisi.libelle} readOnly tabIndex={-1} />
          </label>
          <label>
            Délai de remise
            <input name="dateLimite" type="date" />
          </label>
        </div>
      )}

      {choisi && (
        <p className="note">
          L&apos;intitulé reprend le libellé du poste <code>{choisi.code}</code> — complétez-le si
          l&apos;appel ne porte que sur une partie : « {choisi.libelle} — étages 1 à 4 ».
        </p>
      )}
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
