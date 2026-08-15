'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/**
 * Connexion, en une ou deux étapes.
 *
 * Le second facteur n'ouvre pas un écran séparé : le formulaire bascule sur
 * place, en gardant l'adresse affichée. Renvoyer l'utilisateur sur une autre
 * page lui ferait croire qu'il a recommencé à zéro.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [defiToken, setDefiToken] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function envoyer(corps: Record<string, string>) {
    setErreur(null);
    setEnCours(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        mfaRequis?: boolean;
        defiToken?: string;
      };

      if (!res.ok) {
        setErreur(data.message ?? 'Connexion impossible.');
        return;
      }

      if (data.mfaRequis && data.defiToken) {
        setDefiToken(data.defiToken);
        setCode('');
        return;
      }

      // Le choix de l'espace de travail est une étape à part : un compte peut
      // appartenir à plusieurs sociétés.
      router.push('/espaces');
      router.refresh();
    } catch {
      setErreur("L'API est injoignable.");
    } finally {
      setEnCours(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void (defiToken ? envoyer({ defiToken, code }) : envoyer({ email, motDePasse }));
  }

  if (defiToken) {
    return (
      <form onSubmit={onSubmit} className="form">
        <p className="note">
          Saisir le code affiché par votre application d&apos;authentification pour{' '}
          <strong>{email}</strong>. Un code de secours fonctionne aussi — il ne servira qu&apos;une
          fois.
        </p>

        <label>
          Code de vérification
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            // `one-time-code` déclenche le remplissage automatique depuis le
            // trousseau et les SMS sur iOS et Android.
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
          />
        </label>

        {erreur && <p className="ko">{erreur}</p>}

        <button type="submit" disabled={enCours}>
          {enCours ? 'Vérification…' : 'Vérifier'}
        </button>

        <button
          type="button"
          className="lien"
          onClick={() => {
            setDefiToken(null);
            setErreur(null);
          }}
        >
          Revenir à la connexion
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Adresse e-mail
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </label>

      <label>
        Mot de passe
        <input
          type="password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {erreur && <p className="ko">{erreur}</p>}

      <button type="submit" disabled={enCours}>
        {enCours ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
