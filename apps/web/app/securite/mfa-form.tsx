'use client';

import { useState } from 'react';
import { toString as qrEnSvg } from 'qrcode';

interface EtatMfa {
  actif: boolean;
  enrolementEnCours: boolean;
  codesSecoursRestants: number;
}

/**
 * Enrôlement et retrait du second facteur.
 *
 * Le QR code est fabriqué **dans le navigateur**, à partir de l'URI reçue.
 * Le faire côté serveur supposerait de faire transiter le secret dans une
 * URL — donc dans les journaux de tous les intermédiaires. Il ne quitte pas
 * la page.
 */
export function MfaForm({ etat }: { etat: EtatMfa }) {
  const [actif, setActif] = useState(etat.actif);
  const [restants, setRestants] = useState(etat.codesSecoursRestants);
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codesSecours, setCodesSecours] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function appeler(chemin: string, methode: string, corps?: unknown) {
    setErreur(null);
    setEnCours(true);
    try {
      const res = await fetch(`/api/mfa${chemin}`, {
        method: methode,
        headers: { 'Content-Type': 'application/json' },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setErreur((data.message as string) ?? 'Opération impossible.');
        return null;
      }
      return data;
    } catch {
      setErreur("L'API est injoignable.");
      return null;
    } finally {
      setEnCours(false);
    }
  }

  async function commencer() {
    const data = await appeler('/enrolement', 'POST');
    if (!data) return;
    setSecret(data.secret as string);
    setQr(await qrEnSvg(data.uri as string, { type: 'svg', margin: 1, width: 220 }));
  }

  async function activer() {
    const data = await appeler('/activer', 'POST', { code });
    if (!data) return;
    setCodesSecours(data.codesSecours as string[]);
    setRestants((data.codesSecours as string[]).length);
    setActif(true);
    setSecret(null);
    setQr(null);
    setCode('');
  }

  async function desactiver() {
    const data = await appeler('', 'DELETE', { code });
    if (!data) return;
    setActif(false);
    setRestants(0);
    setCode('');
  }

  // --- Les codes de secours, montrés une seule fois --------------------
  if (codesSecours) {
    return (
      <section>
        <h2>Codes de secours</h2>
        <p className="note">
          <strong>Ils ne seront plus jamais affichés.</strong> Les imprimer ou les ranger dans un
          gestionnaire de mots de passe : ce sont eux qui ouvriront votre compte le jour où le
          téléphone sera perdu. Chacun ne sert qu&apos;une fois.
        </p>
        <table>
          <tbody>
            {codesSecours.map((c) => (
              <tr key={c}>
                <td>
                  <code>{c}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => setCodesSecours(null)}>
          Je les ai notés
        </button>
      </section>
    );
  }

  // --- Enrôlement en cours ---------------------------------------------
  if (secret) {
    return (
      <section>
        <h2>Configurer l&apos;application</h2>
        <p className="note">
          Scanner ce code avec une application d&apos;authentification, puis saisir les six chiffres
          qu&apos;elle affiche. Tant que ce n&apos;est pas fait, la connexion reste inchangée — un
          enrôlement abandonné ne vous enferme pas dehors.
        </p>

        {qr && <div dangerouslySetInnerHTML={{ __html: qr }} />}

        <p className="note">
          Si le scan ne fonctionne pas, saisir la clé à la main : <code>{secret}</code>
        </p>

        <label>
          Code affiché par l&apos;application
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
          />
        </label>

        {erreur && <p className="ko">{erreur}</p>}

        <button type="button" onClick={() => void activer()} disabled={enCours || code.length < 6}>
          {enCours ? 'Vérification…' : 'Activer'}
        </button>
      </section>
    );
  }

  // --- Actif ------------------------------------------------------------
  if (actif) {
    return (
      <section>
        <h2>Second facteur actif</h2>
        <p className="note">
          Votre connexion demande un code en plus du mot de passe.{' '}
          <strong>{restants} code(s) de secours</strong> restant(s).
          {restants <= 2 && ' Il serait prudent de réenrôler pour en obtenir de nouveaux.'}
        </p>

        <label>
          Pour désactiver, saisir un code valide
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
          />
        </label>

        {erreur && <p className="ko">{erreur}</p>}

        <button
          type="button"
          onClick={() => void desactiver()}
          disabled={enCours || code.length < 6}
        >
          {enCours ? 'Vérification…' : 'Désactiver le second facteur'}
        </button>
      </section>
    );
  }

  // --- Inactif ----------------------------------------------------------
  return (
    <section>
      <h2>Second facteur</h2>
      <p className="note">
        Un mot de passe volé suffit aujourd&apos;hui à entrer. Avec un second facteur, il faut en
        plus le téléphone. Sur un produit qui porte des budgets, des contrats et des appels de
        fonds, ça se justifie.
      </p>

      {erreur && <p className="ko">{erreur}</p>}

      <button type="button" onClick={() => void commencer()} disabled={enCours}>
        {enCours ? 'Préparation…' : 'Activer le second facteur'}
      </button>
    </section>
  );
}
