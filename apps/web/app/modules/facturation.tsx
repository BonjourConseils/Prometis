'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi } from '../../lib/api-client';
import { date, francs } from '../../lib/format';

/**
 * Les gestes payants de la page Modules (skill `plans-payants`).
 *
 * Un clic ne facture jamais : chaque geste passe par un récapitulatif, et le
 * bouton qui engage porte le montant. Le montant vient de Stripe, jamais d'un
 * calcul local.
 */

export interface Resultat {
  termine: boolean;
  modules?: string[];
  statut?: string;
  essaiFinLe?: string | null;
  finPeriode?: string | null;
  prochainMontant?: number | null;
  regleAujourdhui?: number;
  recu?: string | null;
}

/** L'écran de résultat : ce qui a été obtenu, ce qui a été réglé, et la suite. */
export function ResultatPaiement({ r }: { r: Resultat }) {
  if (!r.termine) {
    return (
      <p className="note avertissement">
        Le paiement n’est pas terminé : aucun module n’a été ouvert et rien n’a été prélevé.
      </p>
    );
  }
  return (
    <div className="resultat-paiement">
      <h3>C’est fait.</h3>
      <dl>
        <dt>Obtenu</dt>
        <dd>{r.modules?.join(' · ')}</dd>
        <dt>Réglé aujourd’hui</dt>
        <dd>{r.regleAujourdhui ? francs(r.regleAujourdhui) : 'Rien'}</dd>
        {r.essaiFinLe && (
          <>
            <dt>Fin de l’essai</dt>
            <dd>
              {date(r.essaiFinLe)} — vous serez prévenu trois jours avant le premier prélèvement.
            </dd>
          </>
        )}
        {r.prochainMontant != null && (
          <>
            <dt>{r.essaiFinLe ? 'Premier prélèvement' : 'Prochaine échéance'}</dt>
            <dd>
              {francs(r.prochainMontant)}
              {(r.essaiFinLe ?? r.finPeriode) ? ` le ${date(r.essaiFinLe ?? r.finPeriode!)}` : ''},
              TVA comprise, sauf résiliation
            </dd>
          </>
        )}
      </dl>
      {r.recu && (
        <p>
          <a href={r.recu} target="_blank" rel="noopener noreferrer">
            Voir le reçu
          </a>
        </p>
      )}
      <p className="meta">Les écrans du module sont dans le menu de chaque promotion.</p>
    </div>
  );
}

/** Première souscription : choisir, relire, puis Stripe Checkout. */
export function Souscrire({
  modules,
  essaiPermis,
  dureeEssaiJours,
}: {
  modules: { code: string; libelle: string; prixMensuel: string }[];
  essaiPermis: boolean;
  dureeEssaiJours: number;
}) {
  const [choisis, setChoisis] = useState<string[]>([]);
  const [recap, setRecap] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const total = modules
    .filter((m) => choisis.includes(m.code))
    .reduce((s, m) => s + Math.round(Number(m.prixMensuel) * 100), 0);

  async function continuer() {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi<{ url: string }>('/facturation/demarrer', {
      methode: 'POST',
      corps: { modules: choisis },
    });
    if (!res.ok || !res.data.url) {
      setEnCours(false);
      setErreur(res.erreur ?? 'Paiement indisponible.');
      return;
    }
    window.location.assign(res.data.url);
  }

  return (
    <div className="souscrire">
      <fieldset>
        <legend>Choisir les modules</legend>
        {modules.map((m) => (
          <label key={m.code} className="case">
            <input
              type="checkbox"
              checked={choisis.includes(m.code)}
              onChange={(e) => {
                setRecap(false);
                setChoisis((c) =>
                  e.target.checked ? [...c, m.code] : c.filter((x) => x !== m.code),
                );
              }}
            />{' '}
            {m.libelle} — {francs(Math.round(Number(m.prixMensuel) * 100))} HT / mois
          </label>
        ))}
      </fieldset>

      {!recap ? (
        <button type="button" disabled={!choisis.length} onClick={() => setRecap(true)}>
          {essaiPermis ? `Essayer ${dureeEssaiJours} jours` : 'Souscrire'}
        </button>
      ) : (
        <div className="recapitulatif">
          <dl>
            <dt>Aujourd’hui</dt>
            <dd>
              {essaiPermis
                ? 'Rien. Votre carte est demandée, rien n’est prélevé pendant l’essai.'
                : 'Le premier mois, prélevé à la confirmation sur la page de paiement.'}
            </dd>
            <dt>Ensuite</dt>
            <dd>
              {francs(total)} HT par mois, TVA 8.1 % en sus
              {essaiPermis ? `, dès la fin des ${dureeEssaiJours} jours d’essai` : ''}.
            </dd>
            <dt>Annuler</dt>
            <dd>
              À tout moment depuis cette page.{' '}
              {essaiPermis && 'Avant la fin de l’essai : rien n’est prélevé. '}
              Vos données restent consultables après résiliation.
            </dd>
          </dl>
          <p className="meta">
            Le paiement se fait sur la page sécurisée de Stripe, qui affiche le montant exact TVA
            comprise avant toute validation.
          </p>
          <button type="button" className="principal" disabled={enCours} onClick={continuer}>
            {enCours ? 'Ouverture…' : 'Continuer vers le paiement sécurisé'}
          </button>{' '}
          <button type="button" className="lien" onClick={() => setRecap(false)}>
            Modifier
          </button>
        </div>
      )}
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

interface Apercu {
  libelle: string;
  aujourdhui: number;
  ensuite: number;
  prochaineEcheance: string | null;
  enEssai: boolean;
  reprise: boolean;
  prorationDate: number;
}

/** Ajouter un module à l'abonnement : aperçu Stripe, puis « Confirmer et payer X ». */
export function AjouterModule({ code, libelle }: { code: string; libelle: string }) {
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const router = useRouter();

  async function voir() {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi<Apercu>(`/facturation/modules/${code}/apercu`, { methode: 'POST' });
    setEnCours(false);
    if (!res.ok) return setErreur(res.erreur ?? 'Aperçu indisponible.');
    setApercu(res.data);
  }

  async function confirmer() {
    if (!apercu) return;
    setErreur(null);
    setEnCours(true);
    const res = await appelApi<Resultat>(`/facturation/modules/${code}/ajouter`, {
      methode: 'POST',
      corps: { prorationDate: apercu.prorationDate },
    });
    setEnCours(false);
    if (!res.ok) {
      setApercu(null);
      return setErreur(res.erreur ?? 'Ajout impossible.');
    }
    setResultat(res.data);
    router.refresh();
  }

  if (resultat) return <ResultatPaiement r={resultat} />;
  if (!apercu) {
    return (
      <>
        <button type="button" disabled={enCours} onClick={voir}>
          {enCours ? 'Calcul…' : `Ajouter ${libelle}`}
        </button>
        <p className="meta">Montant calculé par Stripe et affiché avant confirmation.</p>
        {erreur && <p className="ko">{erreur}</p>}
      </>
    );
  }
  return (
    <div className="recapitulatif">
      <dl>
        <dt>Aujourd’hui</dt>
        <dd>
          {apercu.aujourdhui > 0
            ? `${francs(apercu.aujourdhui)}, TVA comprise — le prorata jusqu’à l’échéance`
            : apercu.reprise
              ? 'Rien : la période en cours est déjà payée.'
              : apercu.enEssai
                ? 'Rien : vous êtes en essai.'
                : 'Rien.'}
        </dd>
        <dt>Ensuite</dt>
        <dd>
          {francs(apercu.ensuite)} par mois pour l’ensemble de vos modules, TVA comprise
          {apercu.prochaineEcheance ? `, dès le ${date(apercu.prochaineEcheance)}` : ''}.
        </dd>
      </dl>
      <button type="button" className="principal" disabled={enCours} onClick={confirmer}>
        {enCours
          ? 'Paiement…'
          : apercu.aujourdhui > 0
            ? `Confirmer et payer ${francs(apercu.aujourdhui)}`
            : 'Confirmer l’ajout'}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setApercu(null)}>
        Annuler
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

/** Résilier à l'échéance : aucun paiement, accès conservé, annulable. */
export function Resilier({
  code,
  libelle,
  jusquAu,
}: {
  code: string;
  libelle: string;
  jusquAu: string | null;
}) {
  const [recap, setRecap] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const router = useRouter();

  async function confirmer() {
    setEnCours(true);
    const res = await appelApi(`/facturation/modules/${code}/resilier`, { methode: 'POST' });
    setEnCours(false);
    if (!res.ok) return setErreur(res.erreur ?? 'Résiliation impossible.');
    setRecap(false);
    router.refresh();
  }

  if (!recap) {
    return (
      <button type="button" className="lien" onClick={() => setRecap(true)}>
        Résilier
      </button>
    );
  }
  return (
    <div className="recapitulatif">
      <p>
        <strong>Aucun paiement.</strong> {libelle} reste ouvert
        {jusquAu ? ` jusqu’au ${date(jusquAu)}` : ' jusqu’à l’échéance payée'}, puis passe en
        lecture seule : rien n’est effacé. Vous pouvez revenir sur cette décision jusque-là.
      </p>
      <button type="button" disabled={enCours} onClick={confirmer}>
        Confirmer la résiliation
      </button>{' '}
      <button type="button" className="lien" onClick={() => setRecap(false)}>
        Garder le module
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

/** Revenir sur une résiliation programmée — sans rien payer. */
export function Reprendre({ code }: { code: string }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const res = await appelApi(`/facturation/modules/${code}/reprendre`, { methode: 'POST' });
          if (!res.ok) return setErreur(res.erreur ?? 'Impossible.');
          router.refresh();
        }}
      >
        Annuler la résiliation
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/** Le portail Stripe : carte bancaire et factures. */
export function Portail() {
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const res = await appelApi<{ url: string }>('/facturation/portail', { methode: 'POST' });
          if (!res.ok) return setErreur(res.erreur ?? 'Portail indisponible.');
          window.location.assign(res.data.url);
        }}
      >
        Carte bancaire et factures
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
