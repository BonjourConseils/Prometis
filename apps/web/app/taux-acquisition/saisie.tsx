'use client';

import { type FormEvent } from 'react';
import { champ } from '../../lib/api-client';
import { Repliable, useEnvoi } from '../components/formulaire';

const CANTONS: [string, string][] = [
  ['AG', 'Argovie'],
  ['AI', 'Appenzell Rhodes-Intérieures'],
  ['AR', 'Appenzell Rhodes-Extérieures'],
  ['BE', 'Berne'],
  ['BL', 'Bâle-Campagne'],
  ['BS', 'Bâle-Ville'],
  ['FR', 'Fribourg'],
  ['GE', 'Genève'],
  ['GL', 'Glaris'],
  ['GR', 'Grisons'],
  ['JU', 'Jura'],
  ['LU', 'Lucerne'],
  ['NE', 'Neuchâtel'],
  ['NW', 'Nidwald'],
  ['OW', 'Obwald'],
  ['SG', 'Saint-Gall'],
  ['SH', 'Schaffhouse'],
  ['SO', 'Soleure'],
  ['SZ', 'Schwytz'],
  ['TG', 'Thurgovie'],
  ['TI', 'Tessin'],
  ['UR', 'Uri'],
  ['VD', 'Vaud'],
  ['VS', 'Valais'],
  ['ZG', 'Zoug'],
  ['ZH', 'Zurich'],
];

/**
 * Définit le taux d'un canton.
 *
 * `PUT` sur le sigle : un canton n'a qu'un taux. Le même formulaire sert donc
 * à poser et à corriger, sans distinguer les deux gestes.
 */
export function DefinirTaux({ existants }: { existants: string[] }) {
  return (
    <Repliable libelle="Définir un taux">
      {(fermer) => <Formulaire existants={existants} fermer={fermer} />}
    </Repliable>
  );
}

function Formulaire({ existants, fermer }: { existants: string[]; fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/taux-acquisition/${String(d.get('canton'))}`,
      { pourcentage: champ(d.get('pourcentage')), note: champ(d.get('note')) },
      'PUT',
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Ce taux ne sert qu&apos;à <strong>estimer</strong> les frais d&apos;acquisition d&apos;une
        promotion tant qu&apos;ils ne sont pas connus. Dès qu&apos;un montant est saisi sur la
        promotion, c&apos;est lui qui compte et l&apos;estimation disparaît.
      </p>
      <div className="grille-3">
        <label>
          Canton
          <select name="canton" required defaultValue="">
            <option value="" disabled>
              — choisir —
            </option>
            {CANTONS.map(([sigle, nom]) => (
              <option key={sigle} value={sigle}>
                {sigle} · {nom}
                {existants.includes(sigle) ? ' (déjà défini)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Taux (%)
          <input name="pourcentage" required inputMode="decimal" placeholder="3" />
        </label>
        <label>
          Note
          <input name="note" placeholder="Notaire, RF et droits de mutation" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le taux'}
      </button>
    </form>
  );
}

export function SupprimerTaux({ id }: { id: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => void envoyer(`/taux-acquisition/${id}`, undefined, 'DELETE')}
      >
        {enCours ? '…' : 'supprimer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
