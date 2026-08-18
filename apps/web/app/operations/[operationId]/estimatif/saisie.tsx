'use client';

import { useState, type FormEvent } from 'react';
import { appelApi, champ } from '../../../../lib/api-client';
import { chf } from '../../../../lib/format';
import { Repliable, useEnvoi } from '../../../components/formulaire';
import { SupprimerPoste } from '../budget/saisie';

export interface PosteEstimatif {
  id: number;
  code: string;
  libelle: string;
  /** Montant déjà saisi sur CE poste, hors sous-postes. */
  montant: string;
  /** Profondeur dans l'arbre CFC : 0 pour un grand poste. */
  profondeur: number;
  /** Vrai si le poste ne porte ni sous-poste ni montant : supprimable. */
  supprimable: boolean;
}

/**
 * Saisie d'un budget estimatif : un chiffre par grand poste, d'un seul geste.
 *
 * L'écran est volontairement plat. À l'étude de faisabilité on ne descend pas
 * dans l'arborescence : on pose sept ou huit montants, on regarde le bénéfice,
 * on ajuste, et on recommence jusqu'à ce que l'opération tienne. Ouvrir un
 * formulaire par poste rendrait cet aller-retour insupportable.
 *
 * Le total et le bénéfice se recalculent **à la frappe**, sans aller-retour
 * serveur : c'est le seul endroit du produit où le chiffre affiché n'est pas
 * encore celui de la base, et c'est assumé — on cherche un ordre de grandeur,
 * pas une écriture comptable. L'enregistrement, lui, est atomique.
 */
export function SaisieEstimatif({
  operationId,
  versionId,
  postes,
  recettesInitiales,
}: {
  operationId: number;
  versionId: number;
  postes: PosteEstimatif[];
  recettesInitiales: string;
}) {
  const [montants, setMontants] = useState<Record<number, string>>(
    Object.fromEntries(postes.map((p) => [p.id, p.montant === '0' ? '' : p.montant])),
  );
  const [recettes, setRecettes] = useState(recettesInitiales === '0' ? '' : recettesInitiales);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  const nombre = (v: string) => {
    // Le promoteur tape « 1 200 000 » ou « 1'200'000 » : on accepte.
    const propre = v.replace(/[\s'’]/g, '').replace(',', '.');
    const n = Number(propre);
    return Number.isFinite(n) ? n : 0;
  };

  const coutTotal = postes.reduce((t, p) => t + nombre(montants[p.id] ?? ''), 0);
  const totalVentes = nombre(recettes);
  const benefice = totalVentes - coutTotal;
  const marge = totalVentes > 0 ? (benefice / totalVentes) * 100 : 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);
    setEnregistre(false);

    // Deux écritures : les lignes de budget, puis les recettes attendues.
    // La première est atomique côté API ; la seconde ne touche qu'un champ.
    const lignes = await appelApi(
      `/operations/${operationId}/budget/versions/${versionId}/estimatif`,
      {
        methode: 'POST',
        corps: {
          lignes: postes.map((p) => ({
            cfcNodeId: p.id,
            montant: (montants[p.id] ?? '').trim() === '' ? null : String(nombre(montants[p.id]!)),
          })),
        },
      },
    );

    if (!lignes.ok) {
      setEnCours(false);
      setErreur(lignes.erreur ?? 'Enregistrement impossible.');
      return;
    }

    const op = await appelApi(`/operations/${operationId}`, {
      methode: 'PATCH',
      corps: { recettesPrevisionnelles: recettes.trim() === '' ? null : String(totalVentes) },
    });
    setEnCours(false);

    if (!op.ok) {
      setErreur(op.erreur ?? 'Les coûts sont enregistrés, mais pas le total des ventes.');
      return;
    }
    setEnregistre(true);
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <table>
        <thead>
          <tr>
            <th>Poste</th>
            <th className="droite">Montant estimé</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {postes.map((p) => (
            <tr key={p.id} className={p.profondeur === 0 ? 'groupe' : ''}>
              <td style={{ paddingLeft: `${p.profondeur * 1.25}rem` }}>
                <code>{p.code}</code> {p.libelle}
              </td>
              <td className="droite">
                <input
                  className="montant"
                  inputMode="decimal"
                  value={montants[p.id] ?? ''}
                  placeholder="—"
                  onChange={(e) => setMontants({ ...montants, [p.id]: e.target.value })}
                />
              </td>
              <td>
                {/* Un poste chiffré ou porteur de sous-postes n'est pas
                    supprimable : videz d'abord son montant et enregistrez. */}
                {p.supprimable && (
                  <SupprimerPoste operationId={operationId} cfcNodeId={p.id} code={p.code} />
                )}
              </td>
            </tr>
          ))}
          <tr className="groupe">
            <td>
              <strong>Coût total</strong>
            </td>
            <td className="droite">
              <strong>{chf(String(coutTotal))}</strong>
            </td>
            <td></td>
          </tr>
          <tr>
            <td>Total des ventes</td>
            <td className="droite">
              <input
                className="montant"
                inputMode="decimal"
                value={recettes}
                placeholder="—"
                onChange={(e) => setRecettes(e.target.value)}
              />
            </td>
            <td></td>
          </tr>
          <tr className={benefice < 0 ? 'depassement' : 'groupe'}>
            <td>
              <strong>Bénéfice sur la vente</strong>
            </td>
            <td className="droite">
              <strong className={benefice < 0 ? 'ko' : 'ok'}>{chf(String(benefice))}</strong>
              {totalVentes > 0 && (
                <>
                  <br />
                  <span className="meta">{marge.toFixed(1)} % des ventes</span>
                </>
              )}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>

      {erreur && <p className="ko">{erreur}</p>}
      {enregistre && !erreur && <p className="ok">Estimatif enregistré.</p>}

      <button type="submit" className="principal" disabled={enCours}>
        {enCours ? 'Enregistrement…' : "Enregistrer l'estimatif"}
      </button>
    </form>
  );
}

/**
 * Ajoute un poste à l'estimatif.
 *
 * Le même geste que dans le budget CFC, rapproché ici : à la faisabilité on
 * découvre qu'il manque « contribution de remplacement » ou « cédules », et
 * on n'a pas envie d'aller le créer sur un autre écran pour revenir.
 */
export function AjouterPosteEstimatif({
  operationId,
  parents,
}: {
  operationId: number;
  parents: { id: number; code: string; libelle: string }[];
}) {
  return (
    <Repliable libelle="Ajouter un poste">
      {(fermer) => <FormulairePoste operationId={operationId} parents={parents} fermer={fermer} />}
    </Repliable>
  );
}

function FormulairePoste({
  operationId,
  parents,
  fermer,
}: {
  operationId: number;
  parents: { id: number; code: string; libelle: string }[];
  fermer: () => void;
}) {
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
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Code
          <input name="code" required autoFocus placeholder="52" />
        </label>
        <label>
          Libellé
          <input name="libelle" required placeholder="Cédules hypothécaires" />
        </label>
        <label>
          Rattaché à
          <select name="parentId" defaultValue="">
            <option value="">— poste principal —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Créer le poste'}
      </button>
    </form>
  );
}
