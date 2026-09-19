'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

/**
 * Accepter. Nouveau venu : prénom, nom, mot de passe. Compte existant : son
 * mot de passe, qui prouve qu'il en est le titulaire. La connexion se fait
 * ensuite par l'écran habituel — second facteur compris.
 */
export function Accepter({
  jeton,
  compteExistant,
  prenom,
  nom,
}: {
  jeton: string;
  compteExistant: boolean;
  prenom: string | null;
  nom: string | null;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    if (!compteExistant && d.get('motDePasse') !== d.get('confirmation')) {
      return setErreur('Les deux mots de passe diffèrent.');
    }
    setEnCours(true);
    setErreur(null);
    const res = await fetch(`/api/invitation/${jeton}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        motDePasse: String(d.get('motDePasse') ?? ''),
        prenom: d.get('prenom') ?? null,
        nom: d.get('nom') ?? null,
        prisConnaissance: d.get('prisConnaissance') === 'on',
      }),
    }).catch(() => null);
    setEnCours(false);
    if (!res) return setErreur('Service injoignable.');
    const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    if (!res.ok) {
      return setErreur(
        Array.isArray(data.message) ? data.message.join(' · ') : (data.message ?? 'Refusé.'),
      );
    }
    setFait(true);
  }

  if (fait) {
    return (
      <div className="recapitulatif">
        <p className="ok">C’est fait : vous faites partie de l’espace.</p>
        <p>
          <Link className="bouton" href="/login">
            Se connecter
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      {compteExistant ? (
        <label>
          Votre mot de passe Prometis
          <input name="motDePasse" type="password" required autoComplete="current-password" />
        </label>
      ) : (
        <>
          <div className="grille-2">
            <label>
              Prénom
              <input name="prenom" required defaultValue={prenom ?? ''} autoComplete="given-name" />
            </label>
            <label>
              Nom
              <input name="nom" required defaultValue={nom ?? ''} autoComplete="family-name" />
            </label>
          </div>
          <div className="grille-2">
            <label>
              Choisissez un mot de passe (12 caractères au moins)
              <input
                name="motDePasse"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirmez-le
              <input
                name="confirmation"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </label>
          </div>
        </>
      )}
      <label className="case">
        <input type="checkbox" name="prisConnaissance" required /> Je rejoins cet espace : mon nom
        et mon adresse e-mail seront visibles de ses administrateurs, et mes actions y seront
        journalisées.
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Un instant…' : compteExistant ? 'Rejoindre l’espace' : 'Créer mon accès'}
      </button>
    </form>
  );
}
