'use client';

import { useState, type FormEvent } from 'react';
import { champ } from '../../../../lib/api-client';
import { chf } from '../../../../lib/format';
import { Repliable, useEnvoi } from '../../../components/formulaire';

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

/**
 * Assistant de ventilation : remplacer l'estimation d'un groupe par le détail
 * de ses sous-postes.
 *
 * Le reste à ventiler se recalcule à la frappe et sert de garde-fou visuel —
 * mais rien n'oblige à retomber pile sur le montant d'origine. Détailler,
 * c'est justement découvrir que l'estimation était fausse ; un formulaire qui
 * refuserait l'écart obligerait à mentir pour pouvoir enregistrer.
 */
export function VentilerPoste({
  operationId,
  versionId,
  poste,
}: {
  operationId: number;
  versionId: number;
  poste: {
    id: number;
    code: string;
    libelle: string;
    montantPropre: string;
    enfants: { id: number; code: string; libelle: string; montantPropre: string }[];
  };
}) {
  return (
    <Repliable libelle="ventiler">
      {(fermer) => (
        <FormulaireVentilation
          operationId={operationId}
          versionId={versionId}
          poste={poste}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireVentilation({
  operationId,
  versionId,
  poste,
  fermer,
}: {
  operationId: number;
  versionId: number;
  poste: {
    id: number;
    code: string;
    libelle: string;
    montantPropre: string;
    enfants: { id: number; code: string; libelle: string; montantPropre: string }[];
  };
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [montants, setMontants] = useState<Record<number, string>>(
    Object.fromEntries(
      poste.enfants.map((e) => [e.id, e.montantPropre === '0' ? '' : e.montantPropre]),
    ),
  );

  const nb = (v: string) => {
    const n = Number(v.replace(/[\s'\u2019]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const aVentiler = nb(poste.montantPropre);
  const reparti = poste.enfants.reduce((t, e) => t + nb(montants[e.id] ?? ''), 0);
  const reste = aVentiler - reparti;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await envoyer(
      `/operations/${operationId}/budget/versions/${versionId}/cfc/${poste.id}/ventiler`,
      {
        lignes: poste.enfants.map((e) => ({
          cfcNodeId: e.id,
          montant: String(nb(montants[e.id] ?? '')),
        })),
      },
    );
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <p className="note">
        Répartir <strong>{chf(poste.montantPropre)}</strong> du poste {poste.code} sur ses
        sous-postes. La ligne du groupe sera <strong>supprimée</strong> : le détail la remplace, il
        ne s&apos;y ajoute pas.
      </p>

      <table>
        <thead>
          <tr>
            <th>Sous-poste</th>
            <th className="droite">Montant HT</th>
          </tr>
        </thead>
        <tbody>
          {poste.enfants.map((e) => (
            <tr key={e.id}>
              <td>
                <code>{e.code}</code> {e.libelle}
              </td>
              <td className="droite">
                <input
                  className="montant"
                  inputMode="decimal"
                  value={montants[e.id] ?? ''}
                  placeholder="—"
                  onChange={(evt) => setMontants({ ...montants, [e.id]: evt.target.value })}
                />
              </td>
            </tr>
          ))}
          <tr className="groupe">
            <td>
              <strong>Reste à ventiler</strong>
            </td>
            <td className="droite">
              <strong className={reste === 0 ? 'ok' : reste < 0 ? 'ko' : ''}>
                {chf(String(reste))}
              </strong>
            </td>
          </tr>
        </tbody>
      </table>

      {reste !== 0 && (
        <p className="note">
          {reste > 0
            ? `Il reste ${chf(String(reste))} non répartis : le budget du poste diminuera d'autant.`
            : `Le détail dépasse l'estimation de ${chf(String(-reste))} : le budget du poste augmentera d'autant.`}{' '}
          C&apos;est permis — c&apos;est même ce qu&apos;on cherche à mesurer.
        </p>
      )}

      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Ventilation…' : 'Ventiler et remplacer'}
      </button>
    </form>
  );
}

/**
 * Le foncier acheté, porté au budget réel.
 *
 * L'estimatif portait un terrain estimé ; une fois les actes signés, les
 * montants sont connus au franc près. Le budget CFC les reprend en 01
 * (achat) et 02 (frais) — mais **on les propose, on ne les écrit pas**.
 *
 * Un budget qu'on tient face aux soumissions ne doit pas se réécrire tout
 * seul : le promoteur peut avoir porté le terrain autrement — une parcelle
 * apportée, un échange, un prix réparti sur deux versions. Le bouton le
 * laisse décider, et l'écart s'affiche pour qu'il décide en connaissance.
 */
export function FoncierReel({
  operationId,
  versionId,
  achat,
  frais,
  posteAchatId,
  posteFraisId,
  montantAchatActuel,
  montantFraisActuel,
  achetees,
  total,
}: {
  operationId: number;
  versionId: number;
  achat: number;
  frais: number;
  posteAchatId: number | null;
  posteFraisId: number | null;
  montantAchatActuel: number;
  montantFraisActuel: number;
  achetees: number;
  total: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const [fait, setFait] = useState(false);

  if (achetees === 0) return null;
  if (!posteAchatId && !posteFraisId) {
    return (
      <p className="note">
        {achetees} parcelle(s) achetée(s) pour <strong>{chf(String(achat))}</strong>, mais la
        trame CFC de cette promotion n’a ni poste 01 ni poste 02 : impossible d’y porter le
        terrain.
      </p>
    );
  }

  // Au franc près : un écart d'arrondi ne vaut pas une proposition.
  const dejaJuste =
    Math.abs(montantAchatActuel - achat) < 1 && Math.abs(montantFraisActuel - frais) < 1;

  const lignes = [
    ...(posteAchatId ? [{ cfcNodeId: posteAchatId, montant: String(achat) }] : []),
    ...(posteFraisId ? [{ cfcNodeId: posteFraisId, montant: String(frais) }] : []),
  ];

  return (
    <div className="note">
      <p>
        <strong>Le foncier est acheté.</strong> {achetees} parcelle(s) sur {total} —{' '}
        {chf(String(achat))} d’achat
        {frais > 0 && <> et {chf(String(frais))} de frais</>}, montants réels, prouvés par les
        actes.
        {achetees < total && (
          <>
            {' '}
            Les {total - achetees} autre(s) sont encore en négociation : ce qui suit ne les
            couvre pas.
          </>
        )}
      </p>
      {dejaJuste ? (
        <p className="ok">Le budget porte déjà ces montants.</p>
      ) : fait ? (
        <p className="ok">Montants repris en CFC 01 et 02.</p>
      ) : (
        <>
          <p>
            Le budget porte aujourd’hui {chf(String(montantAchatActuel))} en 01 et{' '}
            {chf(String(montantFraisActuel))} en 02.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={enCours}
              onClick={() =>
                void envoyer(
                  `/operations/${operationId}/budget/versions/${versionId}/estimatif`,
                  { lignes },
                  'POST',
                ).then(() => setFait(true))
              }
            >
              {enCours ? 'Reprise…' : 'Porter le foncier réel en CFC 01 et 02'}
            </button>
          </div>
        </>
      )}
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}
