'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, motDePasse }),
      });

      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        const message = (data as { message?: string }).message;
        setErreur(message ?? 'Connexion impossible.');
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
