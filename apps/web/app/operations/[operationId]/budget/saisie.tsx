'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { appelApi, champ } from '../../../../lib/api-client';

interface NoeudPlat {
  id: number;
  code: string;
  libelle: string;
  niveau: number;
}

function useEnvoi() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const envoyer = async (
    chemin: string,
    corps?: unknown,
    methode: string = 'POST',
  ): Promise<boolean> => {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi(chemin, { methode, corps });
    setEnCours(false);

    if (!res.ok) {
      setErreur(res.erreur ?? 'Opération impossible.');
      return false;
    }
    router.refresh();
    return true;
  };

  return { envoyer, erreur, enCours };
}

/**
 * Import de la trame CFC.
 *
 * La trame livrée est la **structure publique** des groupes et sous-groupes,
 * pas le catalogue CRB — celui-ci est sous licence et ne peut pas être
 * recopié dans le produit. Un promoteur qui dispose du sien le substituera.
 */
export function ImporterTrame({ operationId }: { operationId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <div>
      <p className="note">
        Aucun poste CFC. La trame de départ pose les groupes 0 à 5 et leurs sous-groupes usuels — de
        quoi commencer à chiffrer sans tout saisir à la main.
      </p>
      {erreur && <p className="ko">{erreur}</p>}
      <button
        type="button"
        className="principal"
        disabled={enCours}
        onClick={() => void envoyer(`/operations/${operationId}/cfc/importer-trame`, {})}
      >
        {enCours ? 'Import…' : 'Importer la trame CFC'}
      </button>
    </div>
  );
}

/** Création d'un poste, sous un parent choisi dans l'arbre existant. */
export function AjouterPoste({
  operationId,
  noeuds,
}: {
  operationId: number;
  noeuds: NoeudPlat[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const parent = champ(d.get('parentId'));
    const ok = await envoyer(`/operations/${operationId}/cfc`, {
      code: champ(d.get('code')),
      libelle: champ(d.get('libelle')),
      parentId: parent === undefined ? undefined : Number(parent),
    });
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        Ajouter un poste
      </button>
    );
  }

  return (
    <div className="saisie">
      <form onSubmit={onSubmit} className="form">
        <div className="grille-3">
          <label>
            Code
            <input name="code" required autoFocus placeholder="271.0" />
          </label>
          <label>
            Libellé
            <input name="libelle" required placeholder="Plâtrerie — travaux" />
          </label>
          <label>
            Poste parent
            <select name="parentId" defaultValue="">
              <option value="">— racine —</option>
              {noeuds.map((n) => (
                <option key={n.id} value={n.id}>
                  {' '.repeat((n.niveau - 1) * 2)}
                  {n.code} · {n.libelle}
                </option>
              ))}
            </select>
          </label>
        </div>
        {erreur && <p className="ko">{erreur}</p>}
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer le poste'}
        </button>
      </form>
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}

/**
 * Création d'une version de budget.
 *
 * Une révision se crée en **copiant** la version courante : on ne resaisit
 * pas quarante postes. Elle naît en brouillon — un budget se travaille avant
 * d'être adopté.
 */
export function AjouterVersion({
  operationId,
  versions,
}: {
  operationId: number;
  versions: { id: number; libelle: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const source = champ(d.get('copierDepuisId'));
    const ok = await envoyer(`/operations/${operationId}/budget/versions`, {
      libelle: champ(d.get('libelle')),
      commentaire: champ(d.get('commentaire')),
      copierDepuisId: source === undefined ? undefined : Number(source),
    });
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        {versions.length === 0 ? 'Créer le budget initial' : 'Créer une révision'}
      </button>
    );
  }

  return (
    <div className="saisie">
      <form onSubmit={onSubmit} className="form">
        <div className="grille-2">
          <label>
            Libellé
            <input
              name="libelle"
              required
              autoFocus
              defaultValue={versions.length === 0 ? 'Budget initial' : ''}
              placeholder="Budget révisé n° 1"
            />
          </label>
          {versions.length > 0 && (
            <label>
              Copier les lignes depuis
              <select name="copierDepuisId" defaultValue="">
                <option value="">— partir d&apos;un budget vide —</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.libelle}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label>
          Commentaire
          <input name="commentaire" placeholder="Après adjudication du gros œuvre" />
        </label>
        {erreur && <p className="ko">{erreur}</p>}
        <button type="submit" disabled={enCours}>
          {enCours ? 'Création…' : 'Créer la version'}
        </button>
      </form>
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}

/** Adoption d'une version : elle devient le budget courant de la promotion. */
export function AdopterVersion({
  operationId,
  versionId,
}: {
  operationId: number;
  versionId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      {erreur && <p className="ko">{erreur}</p>}
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/budget/versions/${versionId}`,
            { statut: 'VALIDE', isCourant: true },
            'PATCH',
          )
        }
      >
        {enCours ? 'Adoption…' : 'Adopter ce budget'}
      </button>
    </>
  );
}

/**
 * Saisie d'une ligne de budget.
 *
 * Tous les montants sont **hors taxe**, comme partout dans le fil rouge :
 * comparer un budget HT à une facture TTC afficherait un dépassement de
 * 8,1 % qui n'existe pas.
 */
export function AjouterLigne({
  operationId,
  versionId,
  noeuds,
}: {
  operationId: number;
  versionId: number;
  noeuds: NoeudPlat[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/budget/versions/${versionId}/lignes`, {
      cfcNodeId: Number(d.get('cfcNodeId')),
      designation: champ(d.get('designation')),
      montant: champ(d.get('montant')),
      estReserve: d.get('estReserve') === 'on',
    });
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        Ajouter une ligne de budget
      </button>
    );
  }

  return (
    <div className="saisie">
      <form onSubmit={onSubmit} className="form">
        <p className="note">
          Montant <strong>hors taxe</strong>. Une réserve est comptée dans les coûts mais signalée à
          part au bilan : elle n&apos;est pas engagée.
        </p>
        <div className="grille-3">
          <label>
            Poste CFC
            <select name="cfcNodeId" required defaultValue="">
              <option value="" disabled>
                — choisir —
              </option>
              {noeuds.map((n) => (
                <option key={n.id} value={n.id}>
                  {' '.repeat((n.niveau - 1) * 2)}
                  {n.code} · {n.libelle}
                </option>
              ))}
            </select>
          </label>
          <label>
            Désignation
            <input name="designation" placeholder="Maçonnerie et béton armé" />
          </label>
          <label>
            Montant HT
            <input name="montant" required inputMode="decimal" placeholder="3100000" />
          </label>
        </div>
        <label className="case">
          <input name="estReserve" type="checkbox" />
          <span>
            Réserve pour imprévus
            <span className="meta">Comptée dans les coûts, signalée à part au bilan.</span>
          </span>
        </label>
        {erreur && <p className="ko">{erreur}</p>}
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer la ligne'}
        </button>
      </form>
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}
