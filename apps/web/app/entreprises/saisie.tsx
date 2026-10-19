'use client';

import { useState, type FormEvent } from 'react';
import { appelApi, champ } from '../../lib/api-client';
import { useEnvoi } from '../components/formulaire';

export interface Employe {
  id: number;
  nom: string;
  prenom: string | null;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
}

export interface ValeursEntreprise {
  id: number;
  nom: string;
  corpsMetier: string | null;
  contactNom: string | null;
  email: string | null;
  telephone: string | null;
  ide: string | null;
  siteWeb: string | null;
  adresse: string | null;
  codePostal: string | null;
  localite: string | null;
  note: string | null;
  employes: Employe[];
  _count: { offres: number; contrats: number };
}

/** Ce que la lecture d'un site web propose. */
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
}

/**
 * Créer ou corriger une entreprise du répertoire.
 *
 * **Le site web ouvre le formulaire** : on colle l'adresse, « Rechercher »
 * lit la page — et, si le serveur a la clé, complète par une recherche web —
 * puis **propose** les champs. Rien n'est enregistré avant relecture : ce
 * qu'un site annonce n'est pas une saisie, et une raison sociale fausse se
 * retrouve ensuite sur un contrat.
 */
function FormulaireEntreprise({
  entreprise,
  fermer,
}: {
  entreprise?: ValeursEntreprise;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [site, setSite] = useState(entreprise?.siteWeb ?? '');
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const corps = {
      nom: champ(d.get('nom')),
      corpsMetier: champ(d.get('corpsMetier')),
      contactNom: champ(d.get('contactNom')),
      adresse: champ(d.get('adresse')),
      codePostal: champ(d.get('codePostal')),
      localite: champ(d.get('localite')),
      email: champ(d.get('email')),
      telephone: champ(d.get('telephone')),
      siteWeb: champ(d.get('siteWeb')),
      ide: champ(d.get('ide')),
      note: champ(d.get('note')),
    };
    const ok = entreprise
      ? await envoyer(`/entreprises/${entreprise.id}`, corps, 'PATCH')
      : await envoyer('/entreprises', corps);
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form" key={version}>
      <fieldset className="cadre">
        <legend>Remplir depuis le site</legend>
        <p className="note">
          Collez l&apos;adresse du site de l&apos;entreprise : l&apos;app en tire la raison
          sociale, l&apos;adresse, le contact et l&apos;IDE, et vous relisez.
        </p>
        <div className="champ-actions">
          <label>
            Site web
            <input
              name="siteWeb"
              type="url"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="https://www.entreprise.ch"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void rechercher()} disabled={cherche || !site}>
              {cherche ? 'Lecture du site…' : 'Rechercher et remplir'}
            </button>
          </div>
          {message && <p className="note">{message}</p>}
        </div>
      </fieldset>

      <div className="grille-3">
        <label>
          Raison sociale
          <input
            name="nom"
            required
            defaultValue={trouve?.societeNom ?? entreprise?.nom ?? ''}
            placeholder="Plâtrerie Dubois SA"
          />
        </label>
        <label>
          Corps de métier
          <input
            name="corpsMetier"
            defaultValue={trouve?.metier ?? entreprise?.corpsMetier ?? ''}
            placeholder="Plâtrerie"
          />
        </label>
        <label>
          IDE
          <input
            name="ide"
            defaultValue={trouve?.ide ?? entreprise?.ide ?? ''}
            placeholder="CHE-123.456.789"
          />
        </label>
      </div>

      <div className="grille-3">
        <label>
          Adresse
          <input name="adresse" defaultValue={trouve?.adresse ?? entreprise?.adresse ?? ''} />
        </label>
        <label>
          Code postal
          <input
            name="codePostal"
            defaultValue={trouve?.codePostal ?? entreprise?.codePostal ?? ''}
          />
        </label>
        <label>
          Localité
          <input name="localite" defaultValue={trouve?.localite ?? entreprise?.localite ?? ''} />
        </label>
      </div>

      <div className="grille-3">
        <label>
          Contact principal
          <input
            name="contactNom"
            defaultValue={
              trouve
                ? [trouve.prenom, trouve.nom].filter(Boolean).join(' ')
                : (entreprise?.contactNom ?? '')
            }
          />
        </label>
        <label>
          E-mail
          <input
            name="email"
            type="email"
            defaultValue={trouve?.email ?? entreprise?.email ?? ''}
          />
        </label>
        <label>
          Téléphone
          <input name="telephone" defaultValue={trouve?.telephone ?? entreprise?.telephone ?? ''} />
        </label>
      </div>

      <label>
        Note
        <input
          name="note"
          defaultValue={entreprise?.note ?? ''}
          placeholder="Travaille bien le second œuvre, délais tenus"
        />
      </label>

      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : entreprise ? 'Enregistrer' : 'Ajouter l’entreprise'}
        </button>
        <button type="button" className="lien" onClick={fermer}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function AjouterEntreprise() {
  const [ouvert, setOuvert] = useState(false);
  return ouvert ? (
    <FormulaireEntreprise fermer={() => setOuvert(false)} />
  ) : (
    <button type="button" onClick={() => setOuvert(true)}>
      Ajouter une entreprise
    </button>
  );
}

/** Ajouter un interlocuteur chez une entreprise. */
function AjouterEmploye({ entrepriseId }: { entrepriseId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [ouvert, setOuvert] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/entreprises/${entrepriseId}/employes`, {
      nom: champ(d.get('nom')),
      prenom: champ(d.get('prenom')),
      fonction: champ(d.get('fonction')),
      email: champ(d.get('email')),
      telephone: champ(d.get('telephone')),
    });
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" className="lien" onClick={() => setOuvert(true)}>
        Ajouter un interlocuteur
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Nom
          <input name="nom" required autoFocus />
        </label>
        <label>
          Prénom
          <input name="prenom" />
        </label>
        <label>
          Fonction
          <input name="fonction" placeholder="Chiffrage, chef de chantier, comptabilité…" />
        </label>
      </div>
      <div className="grille-2">
        <label>
          E-mail
          <input name="email" type="email" />
        </label>
        <label>
          Téléphone
          <input name="telephone" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Ajouter'}
        </button>
        <button type="button" className="lien" onClick={() => setOuvert(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function RetirerEmploye({ employeId, nom }: { employeId: number; nom: string }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [confirme, setConfirme] = useState(false);

  if (!confirme) {
    return (
      <button type="button" className="lien" onClick={() => setConfirme(true)}>
        retirer
      </button>
    );
  }
  return (
    <>
      <span className="meta">Retirer {nom} ? </span>
      <button
        type="button"
        className="lien ko"
        disabled={enCours}
        onClick={() => void envoyer(`/entreprises/employes/${employeId}`, undefined, 'DELETE')}
      >
        {enCours ? '…' : 'oui'}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setConfirme(false)}>
        non
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Le répertoire : son tableau, et le formulaire **sous** le tableau.
 *
 * Ouvrir la saisie dans une cellule la comprimerait à la largeur d'une
 * colonne. Le tableau reste un tableau ; la fiche se remplit en pleine
 * largeur.
 */
export function TableauEntreprises({ entreprises }: { entreprises: ValeursEntreprise[] }) {
  const [modifie, setModifie] = useState<number | null>(null);
  const [employes, setEmployes] = useState<number | null>(null);
  const entreprise = entreprises.find((e) => e.id === modifie);

  return (
    <>
      <div className="tableau-large">
        <table>
          <thead>
            <tr>
              <th>Entreprise</th>
              <th>Corps de métier</th>
              <th>Contact</th>
              <th className="droite">Interlocuteurs</th>
              <th className="droite">Offres</th>
              <th className="droite">Contrats</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entreprises.flatMap((e) => [
              <tr key={e.id} className={modifie === e.id ? 'en-edition' : undefined}>
                <td>
                  <strong>{e.nom}</strong>
                  {e.siteWeb && (
                    <>
                      <br />
                      <a href={e.siteWeb} target="_blank" rel="noreferrer noopener">
                        {e.siteWeb.replace(/^https?:\/\//, '')}
                      </a>
                    </>
                  )}
                  {e.localite && (
                    <>
                      <br />
                      <span className="meta">
                        {[e.codePostal, e.localite].filter(Boolean).join(' ')}
                      </span>
                    </>
                  )}
                </td>
                <td>{e.corpsMetier ?? '—'}</td>
                <td>
                  {e.contactNom ?? '—'}
                  {e.email && (
                    <>
                      <br />
                      <span className="meta">{e.email}</span>
                    </>
                  )}
                  {e.telephone && (
                    <>
                      <br />
                      <span className="meta">{e.telephone}</span>
                    </>
                  )}
                </td>
                <td className="droite">
                  <button
                    type="button"
                    className="lien"
                    onClick={() => setEmployes(employes === e.id ? null : e.id)}
                  >
                    {e.employes.length}
                  </button>
                </td>
                <td className="droite">{e._count.offres}</td>
                <td className="droite">{e._count.contrats}</td>
                <td>
                  <button
                    type="button"
                    className="lien"
                    onClick={() => setModifie(modifie === e.id ? null : e.id)}
                  >
                    {modifie === e.id ? 'Fermer' : 'Modifier'}
                  </button>
                </td>
              </tr>,
              employes === e.id ? (
                <tr key={`${e.id}-employes`}>
                  <td colSpan={7}>
                    {e.employes.length === 0 ? (
                      <p className="note">
                        Aucun interlocuteur. On parle au chiffreur pour l&apos;offre, au chef de
                        chantier pendant les travaux, à la comptabilité pour les factures.
                      </p>
                    ) : (
                      <table className="imbrique">
                        <tbody>
                          {e.employes.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <strong>{[p.prenom, p.nom].filter(Boolean).join(' ')}</strong>
                                {p.fonction && (
                                  <>
                                    <br />
                                    <span className="meta">{p.fonction}</span>
                                  </>
                                )}
                              </td>
                              <td>{p.email ?? '—'}</td>
                              <td>{p.telephone ?? '—'}</td>
                              <td>
                                <RetirerEmploye
                                  employeId={p.id}
                                  nom={[p.prenom, p.nom].filter(Boolean).join(' ')}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <AjouterEmploye entrepriseId={e.id} />
                  </td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>
      {entreprise && (
        <FormulaireEntreprise
          key={entreprise.id}
          entreprise={entreprise}
          fermer={() => setModifie(null)}
        />
      )}
    </>
  );
}
