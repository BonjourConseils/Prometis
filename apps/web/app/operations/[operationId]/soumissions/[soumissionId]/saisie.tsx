'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../../../../lib/api-client';
import { montant } from '../../../../../lib/format';
import { Repliable, useEnvoi } from '../../../../components/formulaire';

interface Entreprise {
  id: number;
  nom: string;
  corpsMetier: string | null;
}

interface OffreAdjugeable {
  id: number;
  entrepriseNom: string;
  montantNet: string | null;
  lignes: { id: number; type: 'OPTION' | 'VARIANTE'; libelle: string; montant: string }[];
}

// ---------------------------------------------------------------------
//  Invitation
// ---------------------------------------------------------------------

/**
 * Inviter une entreprise à soumissionner.
 *
 * L'invitation inscrit l'entreprise sur la liste ; le dossier part ensuite,
 * pour toutes à la fois, avec « Envoyer le dossier ». C'est ce qui donne son sens au compteur « offres reçues sur
 * entreprises consultées » — trois offres sur trois, ce n'est pas la même
 * consultation que trois sur douze.
 */
export function InviterEntreprise({
  operationId,
  soumissionId,
  entreprises,
}: {
  operationId: number;
  soumissionId: number;
  entreprises: Entreprise[];
}) {
  return (
    <Repliable libelle="Inviter une entreprise">
      {(fermer) => (
        <FormulaireInvitation
          operationId={operationId}
          soumissionId={soumissionId}
          entreprises={entreprises}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireInvitation({
  operationId,
  soumissionId,
  entreprises,
  fermer,
}: {
  operationId: number;
  soumissionId: number;
  entreprises: Entreprise[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/soumissions/${soumissionId}/invitations/${Number(d.get('entrepriseId'))}`,
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Entreprise
        <select name="entrepriseId" required defaultValue="">
          <option value="" disabled>
            — choisir —
          </option>
          {entreprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nom}
              {e.corpsMetier ? ` · ${e.corpsMetier}` : ''}
            </option>
          ))}
        </select>
      </label>
      {entreprises.length === 0 && (
        <p className="note">
          Le répertoire est vide. Ajoutez l&apos;entreprise depuis la liste des soumissions.
        </p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'invitation"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Offre
// ---------------------------------------------------------------------

/**
 * Saisir l'offre d'une entreprise.
 *
 * Ressaisir la même entreprise **remplace** son offre : une entreprise n'a
 * qu'une offre par soumission, et une offre corrigée reste la même offre.
 */
export function EnregistrerOffre({
  operationId,
  soumissionId,
  entreprises,
}: {
  operationId: number;
  soumissionId: number;
  entreprises: Entreprise[];
}) {
  return (
    <Repliable libelle="Enregistrer une offre">
      {(fermer) => (
        <FormulaireOffre
          operationId={operationId}
          soumissionId={soumissionId}
          entreprises={entreprises}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireOffre({
  operationId,
  soumissionId,
  entreprises,
  fermer,
}: {
  operationId: number;
  soumissionId: number;
  entreprises: Entreprise[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/soumissions/${soumissionId}/offres`, {
      entrepriseId: Number(d.get('entrepriseId')),
      // Montants en chaîne : c'est le serveur qui les convertit en Decimal.
      montant: champ(d.get('montant')),
      remisePct: champ(d.get('remisePct')),
      dateReception: champ(d.get('dateReception')),
      statut: champ(d.get('statut')),
      note: champ(d.get('note')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Montant <strong>hors taxe</strong>, tel qu&apos;il figure au récapitulatif de l&apos;offre.
        La remise s&apos;applique dessus : c&apos;est le net qui sera adjugé et porté au contrat.
      </p>
      <div className="grille-3">
        <label>
          Entreprise
          <select name="entrepriseId" required defaultValue="">
            <option value="" disabled>
              — choisir —
            </option>
            {entreprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
                {e.corpsMetier ? ` · ${e.corpsMetier}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Montant brut HT
          <input name="montant" required inputMode="decimal" placeholder="2980000" />
        </label>
        <label>
          Remise (%)
          <input name="remisePct" inputMode="decimal" placeholder="2.5" />
        </label>
      </div>
      <div className="grille-3">
        <label>
          Date de réception
          <input name="dateReception" type="date" />
        </label>
        <label>
          Statut
          <select name="statut" defaultValue="RECUE">
            <option value="RECUE">Reçue</option>
            <option value="ATTENDUE">Attendue</option>
            <option value="RELANCE">Relancée</option>
            <option value="ECARTEE">Écartée</option>
          </select>
        </label>
        <label>
          Remarque
          <input name="note" placeholder="Variante en béton apparent" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'offre"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Adjudication
// ---------------------------------------------------------------------

/**
 * Prononcer l'adjudication.
 *
 * C'est le geste qui engage la société : il fige le montant adjugé, écarte
 * les autres offres et verrouille la soumission. Le formulaire ne
 * présélectionne donc **rien** — pas même le moins-disant — pour que le
 * choix soit posé, pas subi.
 */
export function Adjuger({
  operationId,
  soumissionId,
  offres,
}: {
  operationId: number;
  soumissionId: number;
  offres: OffreAdjugeable[];
}) {
  return (
    <Repliable libelle="Prononcer l'adjudication">
      {(fermer) => (
        <FormulaireAdjudication
          operationId={operationId}
          soumissionId={soumissionId}
          offres={offres}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireAdjudication({
  operationId,
  soumissionId,
  offres,
  fermer,
}: {
  operationId: number;
  soumissionId: number;
  offres: OffreAdjugeable[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [offreId, setOffreId] = useState<number | null>(null);
  const choisie = offres.find((o) => o.id === offreId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const variante = champ(d.get('variante'));
    const lignesRetenues = [
      ...d.getAll('option').map((v) => Number(v)),
      ...(variante ? [Number(variante)] : []),
    ];
    const ok = await envoyer(
      `/operations/${operationId}/soumissions/${soumissionId}/adjudication`,
      {
        offreId: Number(d.get('offreId')),
        lignesRetenues,
        commentaire: champ(d.get('commentaire')),
      },
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        L&apos;adjudication <strong>engage la société</strong> : elle fige le montant, écarte les
        autres offres et ferme la soumission. Le montant retenu est le net après remise — c&apos;est
        lui qui alimente la colonne « adjugé » du budget CFC.
      </p>
      <div className="grille-2">
        <label>
          Offre retenue
          <select
            name="offreId"
            required
            defaultValue=""
            onChange={(e) => setOffreId(Number(e.target.value) || null)}
          >
            <option value="" disabled>
              — choisir —
            </option>
            {offres.map((o) => (
              <option key={o.id} value={o.id}>
                {o.entrepriseNom} — {montant(o.montantNet)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Motif de la décision
          <input name="commentaire" placeholder="Références chantier et délai d'exécution" />
        </label>
      </div>
      {choisie && choisie.lignes.length > 0 && (
        <fieldset>
          <legend>Ce que vous retenez de cette offre</legend>
          {choisie.lignes
            .filter((l) => l.type === 'VARIANTE')
            .map((l) => (
              <label key={l.id} className="case">
                <input type="radio" name="variante" value={l.id} defaultChecked={false} /> Variante
                : {l.libelle} — {montant(l.montant)} (à la place de l&apos;offre de base)
              </label>
            ))}
          {choisie.lignes.some((l) => l.type === 'VARIANTE') && (
            <label className="case">
              <input type="radio" name="variante" value="" defaultChecked /> Offre de base
            </label>
          )}
          {choisie.lignes
            .filter((l) => l.type === 'OPTION')
            .map((l) => (
              <label key={l.id} className="case">
                <input type="checkbox" name="option" value={l.id} /> Option : {l.libelle} —{' '}
                {montant(l.montant)}
              </label>
            ))}
          <p className="meta">
            Le montant adjugé est calculé par le serveur : base ou variante, plus les options
            retenues, remise déduite.
          </p>
        </fieldset>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Adjudication…' : "Prononcer l'adjudication"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Contrat
// ---------------------------------------------------------------------

/**
 * Générer le contrat d'entreprise depuis l'adjudication.
 *
 * Le montant n'est pas saisi : il vient de l'adjudication. Un contrat qui
 * s'écarterait du montant adjugé se ferait par avenant, tracé comme tel.
 */
export function CreerContrat({
  operationId,
  adjudicationId,
}: {
  operationId: number;
  adjudicationId: number;
}) {
  return (
    <Repliable libelle="Générer le contrat">
      {(fermer) => (
        <FormulaireContrat
          operationId={operationId}
          adjudicationId={adjudicationId}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireContrat({
  operationId,
  adjudicationId,
  fermer,
}: {
  operationId: number;
  adjudicationId: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/adjudications/${adjudicationId}/contrat`, {
      reference: champ(d.get('reference')),
      retenueGarantiePct: champ(d.get('retenueGarantiePct')),
      dateSignature: champ(d.get('dateSignature')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Contrat d&apos;entreprise selon la norme <strong>SIA 118</strong>. La retenue de garantie
        usuelle est de 10 % — elle se libère à la réception des travaux.
      </p>
      <div className="grille-3">
        <label>
          Référence
          <input name="reference" autoFocus placeholder="CTR-2026-004" />
        </label>
        <label>
          Retenue de garantie (%)
          <input name="retenueGarantiePct" inputMode="decimal" defaultValue="10" />
        </label>
        <label>
          Date de signature
          <input name="dateSignature" type="date" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Génération…' : 'Générer le contrat'}
      </button>
    </form>
  );
}
