'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { appelApi, champ, televerser } from '../../../../lib/api-client';
import { montant as formaterMontant } from '../../../../lib/format';
import { Repliable, useEnvoi } from '../../../components/formulaire';

export interface Poste {
  id: number;
  code: string;
  libelle: string;
}

export interface ContratChoisi {
  id: number;
  reference: string | null;
  entrepriseNom: string;
}

export interface EntrepriseChoisie {
  id: number;
  nom: string;
}

function OptionsPostes({ postes }: { postes: Poste[] }) {
  return (
    <>
      {postes.map((p) => (
        <option key={p.id} value={p.id}>
          {p.code} · {p.libelle}
        </option>
      ))}
    </>
  );
}

function OptionsContrats({ contrats }: { contrats: ContratChoisi[] }) {
  return (
    <>
      {contrats.map((c) => (
        <option key={c.id} value={c.id}>
          {c.reference ?? `Contrat ${c.id}`} · {c.entrepriseNom}
        </option>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------
//  Création
// ---------------------------------------------------------------------

/**
 * Enregistrer une facture fournisseur.
 *
 * Tout est facultatif sauf ce que l'utilisateur connaît : une facture peut
 * être créée vide puis complétée par la lecture du PDF. Le rattachement au
 * **contrat** est ce qui rend le contrôle « facturé cumulé ≤ commandé »
 * possible — sans lui, rien ne borne le facturé.
 */
export function AjouterFacture({
  operationId,
  entreprises,
  contrats,
  postes,
}: {
  operationId: number;
  entreprises: EntrepriseChoisie[];
  contrats: ContratChoisi[];
  postes: Poste[];
}) {
  return (
    <Repliable libelle="Enregistrer une facture">
      {(fermer) => (
        <FormulaireFacture
          operationId={operationId}
          entreprises={entreprises}
          contrats={contrats}
          postes={postes}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireFacture({
  operationId,
  entreprises,
  contrats,
  postes,
  fermer,
}: {
  operationId: number;
  entreprises: EntrepriseChoisie[];
  contrats: ContratChoisi[];
  postes: Poste[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const nombreOuRien = (nom: string) => {
      const valeur = champ(d.get(nom));
      return valeur === undefined ? undefined : Number(valeur);
    };

    const ok = await envoyer(`/operations/${operationId}/factures`, {
      entrepriseId: nombreOuRien('entrepriseId'),
      contratId: nombreOuRien('contratId'),
      cfcNodeId: nombreOuRien('cfcNodeId'),
      type: champ(d.get('type')),
      numero: champ(d.get('numero')),
      dateFacture: champ(d.get('dateFacture')),
      montantHT: champ(d.get('montantHT')),
      tvaPct: champ(d.get('tvaPct')),
      montantTTC: champ(d.get('montantTTC')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Le montant du fil rouge est le <strong>hors taxe</strong> : c&apos;est lui qui se compare au
        budget et au commandé. Le TTC ne sert qu&apos;au règlement.
      </p>
      <div className="grille-3">
        <label>
          Fournisseur
          <select name="entrepriseId" defaultValue="">
            <option value="">— à déterminer —</option>
            {entreprises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contrat
          <select name="contratId" defaultValue="">
            <option value="">— hors contrat —</option>
            <OptionsContrats contrats={contrats} />
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue="SITUATION">
            <option value="SITUATION">Situation</option>
            <option value="ACOMPTE">Acompte</option>
            <option value="SOLDE">Solde</option>
            <option value="AVOIR">Avoir (montant négatif)</option>
          </select>
        </label>
      </div>
      <div className="grille-3">
        <label>
          N° de facture
          <input name="numero" autoFocus placeholder="2026-0412" />
        </label>
        <label>
          Date
          <input name="dateFacture" type="date" />
        </label>
        <label>
          Poste CFC
          <select name="cfcNodeId" defaultValue="">
            <option value="">— repris du contrat —</option>
            <OptionsPostes postes={postes} />
          </select>
        </label>
      </div>
      <div className="grille-3">
        <label>
          Montant HT
          <input name="montantHT" inputMode="decimal" placeholder="435000" />
        </label>
        <label>
          TVA (%)
          <input name="tvaPct" inputMode="decimal" defaultValue="8.1" />
        </label>
        <label>
          Montant TTC
          <input name="montantTTC" inputMode="decimal" placeholder="470235" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer la facture'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Dépôt du PDF
// ---------------------------------------------------------------------

/**
 * Dépose le PDF et lance la lecture.
 *
 * L'extraction tourne **sur le serveur** : aucune donnée de fournisseur ne
 * part chez un prestataire. Ce que la lecture trouve ne remplace jamais ce
 * qui a été saisi à la main — elle ne comble que les champs vides, et son
 * imputation CFC reste une proposition jusqu'à validation humaine.
 */
export function DeposerPdf({ operationId, factureId }: { operationId: number; factureId: number }) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    if (!fichier) return;

    setErreur(null);
    setEnCours(true);
    const res = await televerser(`/operations/${operationId}/factures/${factureId}/pdf`, fichier);
    setEnCours(false);
    // Le champ est vidé quoi qu'il arrive : redéposer le même fichier après
    // un échec doit déclencher un nouvel envoi.
    event.target.value = '';

    if (!res.ok) {
      setErreur(res.erreur ?? 'Dépôt impossible.');
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <label className="lien-fichier">
        {enCours ? 'Lecture…' : 'Déposer le PDF'}
        <input type="file" accept="application/pdf" onChange={onChange} disabled={enCours} />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------

interface Controle {
  commande: string;
  dejaFacture: string;
  cumulApres: string;
  resteAFacturer: string;
  depassement: string;
  depasse: boolean;
}

/**
 * Validation humaine — le seul chemin vers la colonne « facturé ».
 *
 * Le contrôle du cumul est lu à l'ouverture du formulaire, pas au moment de
 * l'envoi : le comptable doit voir le dépassement **avant** de décider, pas
 * le découvrir dans un message d'erreur.
 */
export function ValiderFacture({
  operationId,
  factureId,
  postes,
  contrats,
  critiques = [],
}: {
  operationId: number;
  factureId: number;
  postes: Poste[];
  contrats: ContratChoisi[];
  /** Constats critiques du contrôle : ils exigent une confirmation explicite. */
  critiques?: string[];
}) {
  return (
    <Repliable libelle="Valider">
      {(fermer) => (
        <FormulaireValidation
          operationId={operationId}
          factureId={factureId}
          postes={postes}
          contrats={contrats}
          critiques={critiques}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireValidation({
  operationId,
  factureId,
  postes,
  contrats,
  critiques,
  fermer,
}: {
  operationId: number;
  factureId: number;
  postes: Poste[];
  contrats: ContratChoisi[];
  critiques: string[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [controle, setControle] = useState<Controle | null>(null);

  useEffect(() => {
    let vivant = true;
    void appelApi<Controle | null>(
      `/operations/${operationId}/factures/${factureId}/controle`,
    ).then((res) => {
      // `null` est une réponse normale : la facture n'est rattachée à aucun
      // contrat, donc il n'y a pas de commandé à confronter.
      if (vivant && res.ok) setControle(res.data);
    });
    return () => {
      vivant = false;
    };
  }, [operationId, factureId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const cfc = champ(d.get('cfcNodeId'));
    const contrat = champ(d.get('contratId'));

    const ok = await envoyer(`/operations/${operationId}/factures/${factureId}/validation`, {
      cfcNodeId: cfc === undefined ? undefined : Number(cfc),
      contratId: contrat === undefined ? undefined : Number(contrat),
      forcer: d.get('forcer') === 'on',
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      {controle && (
        <p className={controle.depasse ? 'ko' : 'note'}>
          {/* `resteAFacturer` est ce qui restait **avant** cette facture :
              l'écrire après le cumul le ferait lire comme un solde d'après
              validation, ce qu'il n'est pas. */}
          Commandé {formaterMontant(controle.commande)} · déjà facturé{' '}
          {formaterMontant(controle.dejaFacture)}, soit {formaterMontant(controle.resteAFacturer)}{' '}
          encore facturables. Cumul après validation{' '}
          <strong>{formaterMontant(controle.cumulApres)}</strong>
          {controle.depasse ? (
            <>
              {' '}
              — dépassement de {formaterMontant(controle.depassement)}. Un avenant manque, ou cette
              facture est en trop.
            </>
          ) : (
            '.'
          )}
        </p>
      )}
      <div className="grille-2">
        <label>
          Imputation CFC
          <select name="cfcNodeId" defaultValue="">
            <option value="">— garder l&apos;imputation actuelle —</option>
            <OptionsPostes postes={postes} />
          </select>
        </label>
        <label>
          Contrat
          <select name="contratId" defaultValue="">
            <option value="">— garder le rattachement actuel —</option>
            <OptionsContrats contrats={contrats} />
          </select>
        </label>
      </div>
      {(controle?.depasse || critiques.length > 0) && (
        <label className="case">
          <input name="forcer" type="checkbox" />
          <span>
            {critiques.length > 0 && (
              <>
                {critiques.join(' · ')}
                <br />
              </>
            )}
            Valider malgré {controle?.depasse ? 'le dépassement' : 'ces constats'}
            <span className="meta">Le passage en force est tracé dans la piste d&apos;audit.</span>
          </span>
        </label>
      )}
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Validation…' : 'Valider la facture'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Litige, rejet, retour en validation
// ---------------------------------------------------------------------

/** Un changement de statut sans motif ne laisserait aucune trace utile. */
export function ChangerStatut({
  operationId,
  factureId,
}: {
  operationId: number;
  factureId: number;
}) {
  return (
    <Repliable libelle="Litige / rejet">
      {(fermer) => (
        <FormulaireStatut operationId={operationId} factureId={factureId} fermer={fermer} />
      )}
    </Repliable>
  );
}

function FormulaireStatut({
  operationId,
  factureId,
  fermer,
}: {
  operationId: number;
  factureId: number;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/factures/${factureId}/statut`, {
      statut: champ(d.get('statut')),
      motif: champ(d.get('motif')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-2">
        <label>
          Statut
          <select name="statut" defaultValue="LITIGE">
            <option value="LITIGE">En litige</option>
            <option value="REJETEE">Rejetée</option>
            <option value="A_VALIDER">Remettre à valider</option>
          </select>
        </label>
        <label>
          Motif
          <input name="motif" required autoFocus placeholder="Métrés contestés sur le poste 211" />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Paiement
// ---------------------------------------------------------------------

/**
 * Enregistrer un règlement.
 *
 * Le montant est libre : un paiement partiel est courant, et une retenue de
 * garantie fait justement que le payé reste sous le facturé.
 */
export function EnregistrerPaiement({
  operationId,
  factureId,
  suggestion,
}: {
  operationId: number;
  factureId: number;
  suggestion: string | null;
}) {
  return (
    <Repliable libelle="Paiement">
      {(fermer) => (
        <FormulairePaiement
          operationId={operationId}
          factureId={factureId}
          suggestion={suggestion}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulairePaiement({
  operationId,
  factureId,
  suggestion,
  fermer,
}: {
  operationId: number;
  factureId: number;
  suggestion: string | null;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/factures/${factureId}/paiements`, {
      montant: champ(d.get('montant')),
      dateValeur: champ(d.get('dateValeur')),
      moyen: champ(d.get('moyen')),
      reference: champ(d.get('reference')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Montant
          <input
            name="montant"
            required
            autoFocus
            inputMode="decimal"
            defaultValue={suggestion ?? ''}
          />
        </label>
        <label>
          Date de valeur
          <input name="dateValeur" type="date" required />
        </label>
        <label>
          Moyen
          <input name="moyen" placeholder="Virement" />
        </label>
      </div>
      <label>
        Référence
        <input name="reference" placeholder="Ordre groupé du 15.08" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le paiement'}
      </button>
    </form>
  );
}
