'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { champ, televerser } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

/** Les catégories du schéma, dans l'ordre du chantier puis de la vente. */
const CATEGORIES: [string, string][] = [
  ['PLAN', 'Plan'],
  ['PROJET', 'Projet'],
  ['PERMIS', 'Permis de construire'],
  ['AUTORISATION', 'Autorisation'],
  ['SOUMISSION', 'Soumission'],
  ['OFFRE', 'Offre'],
  ['CONTRAT', 'Contrat'],
  ['FACTURE', 'Facture'],
  ['GARANTIE', 'Garantie'],
  ['PV_RECEPTION', 'PV de réception'],
  ['PV_SEANCE', 'PV de séance'],
  ['PHOTO_CHANTIER', 'Photo de chantier'],
  ['EXTRAIT_RF', 'Extrait du registre foncier'],
  ['PPE_ACTE_CONSTITUTIF', 'PPE — acte constitutif'],
  ['PPE_REGLEMENT', 'PPE — règlement'],
  ['PPE_PLAN', 'PPE — plan de répartition'],
  ['ACTE_VENTE', 'Acte de vente'],
  ['RESERVATION', 'Réservation'],
  ['MANDAT_COURTAGE', 'Mandat de courtage'],
  ['ASSURANCE', 'Assurance'],
  ['NOTE', 'Note'],
  ['AUTRE', 'Autre'],
];

export interface LotChoisi {
  id: number;
  reference: string;
}

/**
 * Déposer une pièce en GED.
 *
 * Le fichier et ses métadonnées partent dans le **même** envoi multipart :
 * un document sans titre ni catégorie serait introuvable trois mois plus
 * tard, et déposer d'abord pour classer ensuite laisse toujours des pièces
 * non classées.
 *
 * `visibiliteExterne` est le seul champ qui engage vraiment : il ouvre la
 * pièce hors de la société. Il est donc décoché par défaut et annoncé pour
 * ce qu'il est.
 */
export function DeposerDocument({ operationId, lots }: { operationId: number; lots: LotChoisi[] }) {
  return (
    <Repliable libelle="Déposer un document">
      {(fermer) => <FormulaireDepot operationId={operationId} lots={lots} fermer={fermer} />}
    </Repliable>
  );
}

function FormulaireDepot({
  operationId,
  lots,
  fermer,
}: {
  operationId: number;
  lots: LotChoisi[];
  fermer: () => void;
}) {
  const router = useRouter();
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fichier) {
      setErreur('Choisissez un fichier.');
      return;
    }
    const d = new FormData(event.currentTarget);

    setErreur(null);
    setEnCours(true);
    const res = await televerser(`/operations/${operationId}/documents`, fichier, {
      titre: champ(d.get('titre')),
      description: champ(d.get('description')),
      categorie: champ(d.get('categorie')),
      lotId: champ(d.get('lotId')),
      visibiliteExterne: d.get('visibiliteExterne') === 'on',
    });
    setEnCours(false);

    if (!res.ok) {
      setErreur(res.erreur ?? 'Dépôt impossible.');
      return;
    }
    fermer();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Titre
          <input name="titre" required autoFocus placeholder="Plan du rez — indice C" />
        </label>
        <label>
          Catégorie
          <select name="categorie" defaultValue="AUTRE">
            {CATEGORIES.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rattacher à un lot
          <select name="lotId" defaultValue="">
            <option value="">— toute la promotion —</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                Lot {l.reference}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description
        <input name="description" placeholder="Modification de la trémie d'escalier" />
      </label>
      <label className="lien-fichier">
        {fichier ? `Fichier : ${fichier.name}` : 'Choisir le fichier'}
        <input
          type="file"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFichier(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className="case">
        <input name="visibiliteExterne" type="checkbox" />
        <span>
          Visible hors de la société
          <span className="meta">
            À cocher pour une pièce destinée aux acquéreurs ou aux intervenants externes.
          </span>
        </span>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Dépôt…' : 'Déposer'}
      </button>
    </form>
  );
}

/**
 * Déposer une révision.
 *
 * Le versionnement pointe toujours sur la **racine** de la chaîne : la
 * nouvelle version devient courante, les précédentes restent accessibles.
 * Aucune métadonnée n'est resaisie — c'est le même document, un indice plus
 * loin.
 */
export function DeposerVersion({
  operationId,
  documentId,
}: {
  operationId: number;
  documentId: number;
}) {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    if (!fichier) return;

    setErreur(null);
    setEnCours(true);
    const res = await televerser(
      `/operations/${operationId}/documents/${documentId}/versions`,
      fichier,
    );
    setEnCours(false);
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
        {enCours ? 'Dépôt…' : 'Nouvelle version'}
        <input type="file" onChange={onChange} disabled={enCours} />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

/** Reclasser une pièce, ou ouvrir/fermer sa diffusion externe. */
export function ModifierDocument({
  operationId,
  documentId,
  categorie,
  visibiliteExterne,
}: {
  operationId: number;
  documentId: number;
  categorie: string;
  visibiliteExterne: boolean;
}) {
  return (
    <Repliable libelle="Reclasser">
      {(fermer) => (
        <FormulaireModification
          operationId={operationId}
          documentId={documentId}
          categorie={categorie}
          visibiliteExterne={visibiliteExterne}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireModification({
  operationId,
  documentId,
  categorie,
  visibiliteExterne,
  fermer,
}: {
  operationId: number;
  documentId: number;
  categorie: string;
  visibiliteExterne: boolean;
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/documents/${documentId}`,
      {
        titre: champ(d.get('titre')),
        categorie: champ(d.get('categorie')),
        visibiliteExterne: d.get('visibiliteExterne') === 'on',
      },
      'PATCH',
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-2">
        <label>
          Titre
          <input name="titre" placeholder="— inchangé —" />
        </label>
        <label>
          Catégorie
          <select name="categorie" defaultValue={categorie}>
            {CATEGORIES.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="case">
        <input name="visibiliteExterne" type="checkbox" defaultChecked={visibiliteExterne} />
        <span>Visible hors de la société</span>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}
