'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi, champ } from '../../lib/api-client';

/**
 * Saisie de la clé Kolabimo.
 *
 * La clé ne revient jamais à l'écran — l'API ne la renvoie pas. Le champ est
 * donc toujours vide, et « remplacer » veut dire coller une nouvelle clé.
 * À la première connexion, la réponse porte le **secret de webhook** : c'est
 * le seul moment où il existe en clair hors du serveur, d'où l'encadré qui
 * suit, et qui ne se referme pas tout seul.
 */
export function SaisirCle({
  baseUrlActuelle,
  remplacement,
}: {
  baseUrlActuelle: string | null;
  remplacement: boolean;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(!remplacement);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    setErreur(null);
    setEnCours(true);
    const res = await appelApi<{ secretWebhook: string | null }>('/passerelle/kolabimo', {
      methode: 'PUT',
      corps: { baseUrl: champ(d.get('baseUrl')), cleApi: champ(d.get('cleApi')) },
    });
    setEnCours(false);
    if (!res.ok) {
      setErreur(res.erreur ?? 'Clé refusée.');
      return;
    }
    if (res.data?.secretWebhook) setSecret(res.data.secretWebhook);
    else setOuvert(false);
    router.refresh();
  }

  if (secret) return <SecretAffiche secret={secret} onFermer={() => setSecret(null)} />;

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        Remplacer la clé
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <ol className="etapes">
        <li>
          Dans Kolabimo, avec le compte <strong>titulaire du promoteur</strong> :{' '}
          <em>Ma société → Intégrations &amp; API</em>.
        </li>
        <li>
          Générez une clé d&apos;API. Kolabimo ne l&apos;affiche qu&apos;une fois : copiez-la tout
          de suite.
        </li>
        <li>Collez-la ici. Prometis l&apos;essaie avant de l&apos;enregistrer.</li>
      </ol>
      <div className="grille-2">
        <label>
          Clé d&apos;API Kolabimo
          <input
            name="cleApi"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="kolabimo_…"
            className="mono"
          />
        </label>
        <label>
          Adresse de Kolabimo
          <input name="baseUrl" defaultValue={baseUrlActuelle ?? 'https://kolabimo.ch'} />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button type="submit" className="principal" disabled={enCours}>
          {enCours ? 'Vérification auprès de Kolabimo…' : 'Vérifier et enregistrer'}
        </button>
        {remplacement && (
          <button type="button" onClick={() => setOuvert(false)}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Le secret de webhook, affiché une fois.
 *
 * Il ne se ferme que sur un geste explicite : un encadré qui disparaît au
 * rafraîchissement ferait perdre le secret à celui qui n'a pas encore copié —
 * et il faudrait alors le régénérer.
 */
function SecretAffiche({ secret, onFermer }: { secret: string; onFermer: () => void }) {
  const [copie, setCopie] = useState(false);
  return (
    <div className="note avertissement">
      <p>
        <strong>Secret de signature — affiché une seule fois.</strong> Collez-le dans Kolabimo,{' '}
        <em>Ma société → Intégrations &amp; API → Passerelle Prometis</em>, champ « Secret de
        signature », à côté de l&apos;URL ci-dessous. Perdu, il se régénère ; il ne se relit pas.
      </p>
      <p>
        <code className="secret">{secret}</code>{' '}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => setCopie(true));
          }}
        >
          {copie ? 'Copié' : 'Copier'}
        </button>
      </p>
      <button type="button" onClick={onFermer}>
        C&apos;est collé dans Kolabimo
      </button>
    </div>
  );
}

/** Copier une valeur affichée — l'URL du webhook, typiquement. */
export function Copier({ valeur }: { valeur: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <button
      type="button"
      className="lien"
      onClick={() => {
        void navigator.clipboard.writeText(valeur).then(() => setCopie(true));
      }}
    >
      {copie ? 'copiée' : 'copier'}
    </button>
  );
}

/** Actions sur une connexion existante : tester, régénérer le secret, déconnecter. */
export function ActionsConnexion() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function tester() {
    setEnCours(true);
    const res = await appelApi<{
      derniereErreur: string | null;
      promoteur: { nom: string } | null;
    }>('/passerelle/kolabimo/tester', { methode: 'POST' });
    setEnCours(false);
    if (!res.ok) setMessage({ ok: false, texte: res.erreur ?? 'Test impossible.' });
    else if (res.data?.derniereErreur) setMessage({ ok: false, texte: res.data.derniereErreur });
    else
      setMessage({
        ok: true,
        texte: `Kolabimo répond : ${res.data?.promoteur?.nom ?? 'connexion valide'}.`,
      });
    router.refresh();
  }

  async function regenerer() {
    if (
      !window.confirm(
        "Un nouveau secret remplace l'ancien immédiatement : les webhooks de Kolabimo seront refusés " +
          "jusqu'à ce que vous l'ayez collé dans Kolabimo. Continuer ?",
      )
    )
      return;
    const res = await appelApi<{ secretWebhook: string }>('/passerelle/kolabimo/secret', {
      methode: 'POST',
    });
    if (!res.ok) setMessage({ ok: false, texte: res.erreur ?? 'Régénération impossible.' });
    else if (res.data) setSecret(res.data.secretWebhook);
  }

  async function deconnecter() {
    if (
      !window.confirm(
        'Déconnecter Kolabimo ? Prometis ne pourra plus lire vos promotions, et les webhooks seront refusés. ' +
          'Les opérations déjà rattachées et leurs appels de fonds restent intacts.',
      )
    )
      return;
    const res = await appelApi('/passerelle/kolabimo', { methode: 'DELETE' });
    if (!res.ok) setMessage({ ok: false, texte: res.erreur ?? 'Déconnexion impossible.' });
    router.refresh();
  }

  if (secret) return <SecretAffiche secret={secret} onFermer={() => setSecret(null)} />;

  return (
    <div>
      <div className="actions">
        <button type="button" onClick={tester} disabled={enCours}>
          {enCours ? 'Test…' : 'Tester la connexion'}
        </button>
        <button type="button" onClick={regenerer}>
          Régénérer le secret de signature
        </button>
        <button type="button" onClick={deconnecter}>
          Déconnecter
        </button>
      </div>
      {message && <p className={message.ok ? 'ok' : 'ko'}>{message.texte}</p>}
    </div>
  );
}

interface Rapport {
  operation: { id: number; nom: string };
  lots: { crees: number; misAJour: number };
  parkings: { crees: number; misAJour: number };
  echeancier: {
    creees: number;
    misesAJour: number;
    adoptees: number;
    refus: string[];
    horsKolabimo: string[];
  };
  reservations: {
    recues: number;
    traitees: number;
    ignorees: number;
    enErreur: number;
    erreurs: string[];
  };
}

/**
 * Rattacher une promotion : à une opération existante, ou à une opération
 * créée d'après elle. Le rapport s'affiche en entier — un chiffre par nature
 * d'objet, et les refus en toutes lettres.
 */
export function Rattacher({
  promotionId,
  promotionNom,
  operations,
  dejaLiee,
}: {
  promotionId: number;
  promotionNom: string;
  operations: { id: number; nom: string }[];
  dejaLiee: { id: number; nom: string } | null;
}) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [rapport, setRapport] = useState<Rapport | null>(null);

  async function envoyer(operationId: number | undefined) {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi<Rapport>(
      dejaLiee
        ? `/operations/${dejaLiee.id}/passerelle/synchroniser`
        : `/passerelle/kolabimo/promotions/${promotionId}/rattacher`,
      { methode: 'POST', corps: dejaLiee ? undefined : { operationId } },
    );
    setEnCours(false);
    if (!res.ok) {
      setErreur(res.erreur ?? 'Rattachement impossible.');
      return;
    }
    setRapport(res.data ?? null);
    router.refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const choix = champ(new FormData(event.currentTarget).get('operationId'));
    await envoyer(choix === undefined ? undefined : Number(choix));
  }

  return (
    <div>
      {dejaLiee ? (
        <button
          type="button"
          className="principal"
          onClick={() => envoyer(undefined)}
          disabled={enCours}
        >
          {enCours ? 'Synchronisation…' : 'Resynchroniser depuis Kolabimo'}
        </button>
      ) : (
        <form onSubmit={onSubmit} className="form">
          <label>
            Opération Prometis
            <select name="operationId" defaultValue="">
              <option value="">Créer l&apos;opération « {promotionNom} »</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>
                  Rattacher à « {o.nom} »
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="principal" disabled={enCours}>
            {enCours ? 'Import en cours…' : 'Rattacher et importer'}
          </button>
        </form>
      )}

      {erreur && <p className="ko">{erreur}</p>}

      {rapport && (
        <div className="rapport">
          <p className="ok">
            <strong>{rapport.operation.nom}</strong> est à jour : {rapport.lots.crees} lot(s)
            créé(s), {rapport.lots.misAJour} mis à jour ·{' '}
            {rapport.parkings.crees + rapport.parkings.misAJour} parking(s) ·{' '}
            {rapport.echeancier.creees +
              rapport.echeancier.misesAJour +
              rapport.echeancier.adoptees}{' '}
            étape(s) d&apos;échéancier · {rapport.reservations.traitees} réservation(s) sur{' '}
            {rapport.reservations.recues}.
          </p>
          {[...rapport.echeancier.refus, ...rapport.reservations.erreurs].map((r) => (
            <p key={r} className="ko">
              {r}
            </p>
          ))}
          {rapport.echeancier.horsKolabimo.length > 0 && (
            <p className="note">
              Présentes dans Prometis, absentes de Kolabimo :{' '}
              {rapport.echeancier.horsKolabimo.join(' · ')}. Rien n&apos;a été supprimé — elles
              portent peut-être des appels de fonds.
            </p>
          )}
          <p className="note">
            Aucun appel de fonds n&apos;a été émis. Les lots vendus alors que des étapes étaient
            déjà closes apparaissent dans l&apos;écran Appels de fonds, sous « Dossiers à trancher
            ».
          </p>
        </div>
      )}
    </div>
  );
}
