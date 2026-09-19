'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

async function appeler<T>(jeton: string, action: string, corps?: unknown | FormData) {
  try {
    const res = await fetch(`/api/consultation/${jeton}/${action}`, {
      method: 'POST',
      ...(corps instanceof FormData
        ? { body: corps }
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps ?? {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
    const message = Array.isArray(data.message) ? data.message.join(' · ') : data.message;
    return { ok: res.ok, data, erreur: res.ok ? null : (message ?? `Erreur ${res.status}.`) };
  } catch {
    return { ok: false, data: {} as T, erreur: 'Service injoignable.' };
  }
}

/** Deux étapes : recevoir un code à l'adresse de l'invitation, puis le saisir. */
export function Acces({ jeton }: { jeton: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function demander() {
    setEnCours(true);
    setErreur(null);
    const r = await appeler<{ email: string }>(jeton, 'code');
    setEnCours(false);
    if (!r.ok) return setErreur(r.erreur);
    setEmail(r.data.email);
  }

  async function valider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setEnCours(true);
    setErreur(null);
    const r = await appeler(jeton, 'session', { code });
    setEnCours(false);
    if (!r.ok) return setErreur(r.erreur);
    router.refresh();
  }

  return (
    <div className="form">
      <p>
        Pour protéger le dossier, l’accès se fait en deux temps : ce lien personnel, puis un code à
        six chiffres envoyé à l’adresse e-mail à laquelle l’invitation vous est parvenue.
      </p>
      {!email ? (
        <button type="button" className="principal" disabled={enCours} onClick={demander}>
          {enCours ? 'Envoi…' : 'Recevoir mon code'}
        </button>
      ) : (
        <form onSubmit={valider} className="form">
          <p className="ok">Code envoyé à {email}. Il est valable 15 minutes.</p>
          <label>
            Code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
            />
          </label>
          <button type="submit" className="principal" disabled={enCours}>
            {enCours ? 'Vérification…' : 'Ouvrir le dossier'}
          </button>{' '}
          <button type="button" className="lien" onClick={demander} disabled={enCours}>
            Renvoyer un code
          </button>
        </form>
      )}
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

export function PoserQuestion({ jeton }: { jeton: string }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const question = String(new FormData(form).get('question') ?? '');
    const r = await appeler(jeton, 'questions', { question });
    if (!r.ok) return setErreur(r.erreur);
    form.reset();
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Poser une question
        <textarea name="question" rows={3} required minLength={5} maxLength={3000} />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      {ok && <p className="ok">Question transmise.</p>}
      <button type="submit">Envoyer la question</button>
    </form>
  );
}

interface Ligne {
  type: 'OPTION' | 'VARIANTE';
  libelle: string;
  montant: string;
}

/**
 * Déposer l'offre : le PDF signé fait foi, les montants servent à la
 * comparaison. Un récapitulatif précède le dépôt.
 */
export function DeposerOffre({ jeton, remplace }: { jeton: string; remplace: boolean }) {
  const router = useRouter();
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [recap, setRecap] = useState<FormData | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const maj = (i: number, c: Partial<Ligne>) =>
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...c } : l)));

  function preparer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    d.set('lignes', JSON.stringify(lignes.filter((l) => l.libelle.trim() && l.montant.trim())));
    setRecap(d);
  }

  async function deposer() {
    if (!recap) return;
    setEnCours(true);
    setErreur(null);
    const r = await appeler(jeton, 'offre', recap);
    setEnCours(false);
    if (!r.ok) {
      setRecap(null);
      return setErreur(r.erreur);
    }
    setRecap(null);
    router.refresh();
  }

  if (recap) {
    const f = recap.get('fichier');
    return (
      <div className="recapitulatif">
        <p>
          <strong>À déposer :</strong> CHF {String(recap.get('montant'))} HT
          {recap.get('remisePct') ? `, remise ${String(recap.get('remisePct'))} %` : ''}
          {lignes.length ? `, ${lignes.length} option(s)/variante(s)` : ''} —{' '}
          {f instanceof File ? f.name : ''}.
        </p>
        <p className="meta">
          {remplace
            ? 'Elle remplace votre offre précédente, conservée en version antérieure. '
            : ''}
          Vous recevrez un accusé de réception par e-mail. Vous pourrez la remplacer jusqu’à la date
          limite.
        </p>
        <button type="button" className="principal" disabled={enCours} onClick={deposer}>
          {enCours ? 'Dépôt…' : remplace ? 'Remplacer mon offre' : 'Déposer mon offre'}
        </button>{' '}
        <button type="button" className="lien" onClick={() => setRecap(null)}>
          Modifier
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={preparer} className="form">
      <div className="grille-2">
        <label>
          Montant de l’offre de base, HT (CHF)
          <input name="montant" required inputMode="decimal" placeholder="180000" />
        </label>
        <label>
          Remise (%)
          <input name="remisePct" inputMode="decimal" placeholder="2" />
        </label>
      </div>
      <fieldset>
        <legend>Options et variantes (facultatif)</legend>
        {lignes.map((l, i) => (
          <div key={i} className="grille-3">
            <select
              value={l.type}
              onChange={(e) => maj(i, { type: e.target.value as Ligne['type'] })}
            >
              <option value="OPTION">Option (en plus)</option>
              <option value="VARIANTE">Variante (à la place)</option>
            </select>
            <input
              value={l.libelle}
              placeholder="Libellé"
              onChange={(e) => maj(i, { libelle: e.target.value })}
            />
            <input
              value={l.montant}
              inputMode="decimal"
              placeholder="Montant HT"
              onChange={(e) => maj(i, { montant: e.target.value })}
            />
          </div>
        ))}
        <button
          type="button"
          className="lien"
          onClick={() => setLignes((ls) => [...ls, { type: 'OPTION', libelle: '', montant: '' }])}
        >
          + Ajouter une option ou une variante
        </button>
      </fieldset>
      <label>
        Remarques
        <textarea name="note" rows={2} maxLength={3000} />
      </label>
      <label>
        Offre signée (PDF)
        <input type="file" name="fichier" accept="application/pdf" required />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal">
        Vérifier avant dépôt
      </button>
    </form>
  );
}

export function Decliner({ jeton }: { jeton: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  if (!ouvert) {
    return (
      <p>
        <button type="button" className="lien" onClick={() => setOuvert(true)}>
          Décliner l’invitation
        </button>
      </p>
    );
  }
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        const motif = String(new FormData(e.currentTarget).get('motif') ?? '').trim();
        const r = await appeler(jeton, 'decliner', { motif: motif || null });
        if (!r.ok) return setErreur(r.erreur);
        router.refresh();
      }}
    >
      <label>
        Motif (facultatif)
        <input name="motif" placeholder="Carnet de commandes complet" />
      </label>
      <p className="meta">Vous ne pourrez plus déposer d’offre pour cette consultation.</p>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit">Confirmer le refus</button>{' '}
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </form>
  );
}
