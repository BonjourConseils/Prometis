'use client';

import { useState, type FormEvent } from 'react';
import { useEnvoi } from '../components/formulaire';
import { appelApi } from '../../lib/api-client';

const champ = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export const TYPES_ACTEUR = [
  ['NOTAIRE', 'Notaire'],
  ['GEOMETRE', 'Géomètre'],
  ['INGENIEUR', 'Ingénieur'],
  ['ARCHITECTE', 'Architecte'],
  ['BUREAU_TECHNIQUE', 'Bureau technique'],
  ['ENTREPRISE_GENERALE', 'Entreprise générale'],
  ['COURTIER', 'Courtier'],
  ['MAITRE_OUVRAGE', 'Maître d’ouvrage'],
  ['PILOTE', 'Pilote'],
  ['AUTRE', 'Autre'],
] as const;

export interface ValeursActeur {
  id: number;
  type: string;
  typeLibre: string | null;
  societeNom: string | null;
  nom: string | null;
  prenom: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  localite: string | null;
  email: string | null;
  telephone: string | null;
  siteWeb?: string | null;
  ide: string | null;
}

/**
 * Créer ou corriger un acteur de l'annuaire.
 *
 * L'annuaire est commun à la société : le même notaire sert plusieurs
 * promotions, et se corrige à un seul endroit.
 */
interface Propositions {
  societeNom: string | null;
  prenom: string | null;
  nom: string | null;
  adresse: string | null;
  codePostal: string | null;
  localite: string | null;
  email: string | null;
  telephone: string | null;
  ide: string | null;
  metier: string | null;
  activite: string | null;
}

/**
 * Créer ou corriger un acteur de l'annuaire.
 *
 * Le site web ouvre le formulaire : « Rechercher » lit le site — et, si le
 * serveur a la clé, complète par une recherche web — puis **propose** les
 * champs. Rien n'est enregistré avant que quelqu'un relise et valide.
 */
function FormulaireActeur({ acteur, fermer }: { acteur?: ValeursActeur; fermer: () => void }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [site, setSite] = useState(acteur?.siteWeb ?? '');
  const [cherche, setCherche] = useState(false);
  const [trouve, setTrouve] = useState<Propositions | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Une clé par valeur : changer la clé refait le formulaire avec les
  // valeurs proposées, sans contrôler chaque champ un par un.
  const [version, setVersion] = useState(0);

  async function rechercher() {
    if (!site.trim()) return;
    setCherche(true);
    setMessage(null);
    const res = await appelApi<{
      fiche: Propositions;
      sources: { site: boolean; rechercheWeb: boolean };
    }>('/recherche/site-web', { methode: 'POST', corps: { url: site } });
    setCherche(false);
    if (!res.ok || !res.data?.fiche) {
      setMessage(res.erreur ?? 'Ce site n’a pas pu être lu.');
      return;
    }
    setTrouve(res.data.fiche);
    setVersion((v) => v + 1);
    const { site: lu, rechercheWeb } = res.data.sources;
    setMessage(
      `Champs proposés d’après ${[lu ? 'le site' : null, rechercheWeb ? 'une recherche web' : null]
        .filter(Boolean)
        .join(' et ')} — relisez-les avant d’enregistrer.`,
    );
  }

  const valeur = (cle: keyof Propositions, existante: string | null | undefined) =>
    (trouve?.[cle] ?? existante ?? '') as string;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const corps = {
      type: d.get('type'),
      typeLibre: champ(d.get('typeLibre')),
      societeNom: champ(d.get('societeNom')),
      prenom: champ(d.get('prenom')),
      nom: champ(d.get('nom')),
      adresse: champ(d.get('adresse')),
      codePostal: champ(d.get('codePostal')),
      localite: champ(d.get('localite')),
      email: champ(d.get('email')),
      telephone: champ(d.get('telephone')),
      siteWeb: champ(d.get('siteWeb')),
      ide: champ(d.get('ide')),
    };
    const ok = acteur
      ? await envoyer(`/acteurs/${acteur.id}`, corps, 'PATCH')
      : await envoyer('/acteurs', corps);
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form" key={version}>
      <div className="grille-3">
        <label>
          Site web
          <input
            name="siteWeb"
            autoFocus
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="probatec.ch"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void rechercher();
              }
            }}
          />
        </label>
        <label>
          &nbsp;
          <button
            type="button"
            className="secondaire"
            disabled={cherche || !site.trim()}
            onClick={rechercher}
          >
            {cherche ? 'Recherche…' : 'Rechercher et remplir'}
          </button>
        </label>
        <label>
          Métier
          <select name="type" defaultValue={trouve?.metier ?? acteur?.type ?? 'ARCHITECTE'}>
            {TYPES_ACTEUR.map(([v, libelle]) => (
              <option key={v} value={v}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && <p className="note">{message}</p>}
      <div className="grille-3">
        <label>
          Société
          <input
            name="societeNom"
            defaultValue={valeur('societeNom', acteur?.societeNom)}
            placeholder="Probatec Sàrl"
          />
        </label>
        <label>
          Précision du métier
          <input
            name="typeLibre"
            defaultValue={acteur?.typeLibre ?? ''}
            placeholder="direction des travaux"
          />
        </label>
        <label>
          N° IDE
          <input
            name="ide"
            defaultValue={valeur('ide', acteur?.ide)}
            placeholder="CHE-123.456.789"
          />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Prénom
          <input name="prenom" defaultValue={valeur('prenom', acteur?.prenom)} />
        </label>
        <label>
          Nom
          <input name="nom" defaultValue={valeur('nom', acteur?.nom)} />
        </label>
        <label>
          Téléphone
          <input name="telephone" defaultValue={valeur('telephone', acteur?.telephone)} />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Adresse
          <input name="adresse" defaultValue={valeur('adresse', acteur?.adresse)} />
        </label>
        <label>
          NPA
          <input name="codePostal" defaultValue={valeur('codePostal', acteur?.codePostal)} />
        </label>
        <label>
          Localité
          <input name="localite" defaultValue={valeur('localite', acteur?.localite)} />
        </label>
      </div>
      <label>
        E-mail
        <input name="email" type="email" defaultValue={valeur('email', acteur?.email)} />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : acteur ? 'Enregistrer' : 'Ajouter l’acteur'}
        </button>
        <button type="button" className="secondaire" onClick={fermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function AjouterActeur() {
  const [ouvert, setOuvert] = useState(false);
  return ouvert ? (
    <FormulaireActeur fermer={() => setOuvert(false)} />
  ) : (
    <button type="button" onClick={() => setOuvert(true)}>
      Ajouter un acteur
    </button>
  );
}

/**
 * Un métier de l'annuaire : son tableau, et le formulaire **sous** le
 * tableau.
 *
 * Ouvrir le formulaire dans une cellule le comprimait à la largeur d'une
 * colonne, et la grille à trois colonnes s'empilait en une seule. Le
 * tableau reste un tableau ; la saisie se fait en pleine largeur.
 */
export function TableauActeurs({
  acteurs,
  tenir,
}: {
  acteurs: (ValeursActeur & { _count: { operationActeurs: number } })[];
  tenir: boolean;
}) {
  const [modifie, setModifie] = useState<number | null>(null);
  const acteur = acteurs.find((a) => a.id === modifie);

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Société</th>
            <th>Contact</th>
            <th>Localité</th>
            <th className="droite">Promotions</th>
            {tenir && <th></th>}
          </tr>
        </thead>
        <tbody>
          {acteurs.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.societeNom ?? '—'}</strong>
                {a.ide && (
                  <>
                    <br />
                    <span className="meta">{a.ide}</span>
                  </>
                )}
              </td>
              <td>
                {[a.prenom, a.nom].filter(Boolean).join(' ') || '—'}
                {a.email && (
                  <>
                    <br />
                    <span className="meta">{a.email}</span>
                  </>
                )}
                {a.telephone && (
                  <>
                    <br />
                    <span className="meta">{a.telephone}</span>
                  </>
                )}
                {a.siteWeb && (
                  <>
                    <br />
                    <a href={a.siteWeb} target="_blank" rel="noreferrer noopener">
                      {a.siteWeb.replace(/^https?:\/\//, '')}
                    </a>
                  </>
                )}
              </td>
              <td>{a.localite ?? '—'}</td>
              <td className="droite">{a._count.operationActeurs}</td>
              {tenir && (
                <td>
                  <button
                    type="button"
                    className="lien"
                    onClick={() => setModifie(modifie === a.id ? null : a.id)}
                  >
                    {modifie === a.id ? 'Fermer' : 'Modifier'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {acteur && <FormulaireActeur acteur={acteur} fermer={() => setModifie(null)} />}
    </>
  );
}
