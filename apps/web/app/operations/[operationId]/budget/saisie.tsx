'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { useEnvoi } from '../../../components/formulaire';

/**
 * Poste CFC tel qu'il apparaît dans les listes déroulantes.
 *
 * Volontairement sans indentation par espaces : elle casserait la recherche
 * au clavier, qui compare depuis le premier caractère. Sur soixante-neuf
 * postes, taper « 211 » est le geste utile — et la hiérarchie se lit déjà
 * dans le code, c'est à cela que sert la numérotation CFC.
 */
interface NoeudPlat {
  id: number;
  code: string;
  libelle: string;
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
  versions: { id: number; libelle: string; isCourant: boolean }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  // Copier est le geste normal : on part du budget en vigueur et on affine.
  // Partir d'une page blanche existe, mais ce n'est pas ce qu'on fait en
  // passant de l'estimatif au budget détaillé.
  const source = versions.find((v) => v.isCourant) ?? versions[versions.length - 1];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const choisie = champ(d.get('copierDepuisId'));
    const ok = await envoyer(`/operations/${operationId}/budget/versions`, {
      libelle: champ(d.get('libelle')),
      commentaire: champ(d.get('commentaire')),
      copierDepuisId: choisie === undefined ? undefined : Number(choisie),
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
              <select name="copierDepuisId" defaultValue={source ? String(source.id) : ''}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.libelle}
                    {v.isCourant ? ' (courant)' : ''}
                  </option>
                ))}
                <option value="">— partir d&apos;un budget vide —</option>
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
 * Supprime un poste CFC.
 *
 * L'API refuse dès que quoi que ce soit y est rattaché — sous-poste, ligne de
 * budget, soumission, contrat, facture, avenant — et dit lequel. On ne
 * pré-teste donc rien ici : reproduire ces six conditions côté écran
 * donnerait deux règles à maintenir, et c'est celle de l'API qui compte.
 *
 * Pas de confirmation : un poste supprimable est par construction un poste
 * vide, et se recrée en deux champs.
 */
export function SupprimerPoste({
  operationId,
  cfcNodeId,
  code,
}: {
  operationId: number;
  cfcNodeId: number;
  code: string;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="lien"
        title={`Supprimer le poste ${code}`}
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/cfc/${cfcNodeId}`, undefined, 'DELETE')
        }
      >
        {enCours ? '…' : 'supprimer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Modifie une ligne de budget.
 *
 * Le formulaire est pré-rempli avec l'existant : corriger un montant ne doit
 * pas obliger à resaisir le poste et la désignation. Changer le poste CFC est
 * permis — une ligne mal imputée se déplace, elle ne se supprime pas pour
 * être recréée ailleurs.
 */
export function ModifierLigne({
  operationId,
  ligne,
  noeuds,
}: {
  operationId: number;
  ligne: {
    id: number;
    cfcNodeId: number;
    designation: string | null;
    montant: string;
    estReserve: boolean;
  };
  noeuds: NoeudPlat[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(
      `/operations/${operationId}/budget/lignes/${ligne.id}`,
      {
        cfcNodeId: Number(d.get('cfcNodeId')),
        designation: champ(d.get('designation')) ?? null,
        montant: champ(d.get('montant')),
        estReserve: d.get('estReserve') === 'on',
      },
      'PATCH',
    );
    if (ok) setOuvert(false);
  }

  if (!ouvert) {
    return (
      <button type="button" className="lien" onClick={() => setOuvert(true)}>
        modifier
      </button>
    );
  }

  return (
    <div className="saisie">
      <form onSubmit={onSubmit} className="form">
        <div className="grille-3">
          <label>
            Poste CFC
            <select name="cfcNodeId" required defaultValue={String(ligne.cfcNodeId)}>
              {noeuds.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.code} · {n.libelle}
                </option>
              ))}
            </select>
          </label>
          <label>
            Désignation
            <input name="designation" defaultValue={ligne.designation ?? ''} />
          </label>
          <label>
            Montant HT
            <input name="montant" required inputMode="decimal" defaultValue={ligne.montant} />
          </label>
        </div>
        <label className="case">
          <input name="estReserve" type="checkbox" defaultChecked={ligne.estReserve} />
          <span>Réserve pour imprévus</span>
        </label>
        {erreur && <p className="ko">{erreur}</p>}
        <button type="submit" disabled={enCours}>
          {enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}

/** Supprime une ligne. Une ligne de budget n'engage rien : pas de confirmation. */
export function SupprimerLigne({ operationId, ligneId }: { operationId: number; ligneId: number }) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() =>
          void envoyer(`/operations/${operationId}/budget/lignes/${ligneId}`, undefined, 'DELETE')
        }
      >
        {enCours ? '…' : 'supprimer'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Supprime une version de budget.
 *
 * N'apparaît que pour un **brouillon non courant** : l'API refuse le reste,
 * et proposer un bouton qui répond « non » est une façon de faire perdre son
 * temps. La confirmation est explicite parce que les lignes partent avec.
 */
export function SupprimerVersion({
  operationId,
  versionId,
  libelle,
  nombreLignes,
}: {
  operationId: number;
  versionId: number;
  libelle: string;
  nombreLignes: number;
}) {
  const [confirme, setConfirme] = useState(false);
  const { envoyer, erreur, enCours } = useEnvoi();

  if (!confirme) {
    return (
      <button type="button" onClick={() => setConfirme(true)}>
        Supprimer cette version
      </button>
    );
  }

  return (
    <div className="saisie">
      <p className="ko">
        Supprimer « {libelle} » ?{' '}
        {nombreLignes > 0
          ? `Ses ${nombreLignes} ligne${nombreLignes > 1 ? 's' : ''} de budget ${nombreLignes > 1 ? 'partent' : 'part'} avec elle.`
          : 'Elle ne contient aucune ligne.'}{' '}
        L&apos;opération est définitive.
      </p>
      {erreur && <p className="ko">{erreur}</p>}
      <div className="actions">
        <button
          type="button"
          className="principal"
          disabled={enCours}
          onClick={() =>
            void envoyer(
              `/operations/${operationId}/budget/versions/${versionId}`,
              undefined,
              'DELETE',
            )
          }
        >
          {enCours ? 'Suppression…' : 'Supprimer définitivement'}
        </button>
        <button type="button" className="lien" onClick={() => setConfirme(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/**
 * Archive une version validée.
 *
 * Le pendant de la suppression pour ce qui a servi : la version sort de la
 * vue courante sans que sa trace disparaisse. C'est ce que le modèle prévoit,
 * et ce qu'on doit à quiconque a pris une décision sur ce budget.
 */
export function ArchiverVersion({
  operationId,
  versionId,
}: {
  operationId: number;
  versionId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() =>
          void envoyer(
            `/operations/${operationId}/budget/versions/${versionId}`,
            { statut: 'ARCHIVE' },
            'PATCH',
          )
        }
      >
        {enCours ? 'Archivage…' : 'Archiver'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
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
