'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const STATUTS = [
  ['MONTAGE', 'Montage'],
  ['EN_PREPARATION', 'En préparation'],
  ['EN_CHANTIER', 'En chantier'],
  ['EN_COMMERCIALISATION', 'En commercialisation'],
  ['LIVRAISON', 'Livraison'],
  ['CLOTUREE', 'Clôturée'],
] as const;

const MODES = [
  ['CORPS_DETAT_SEPARES', "Corps d'état séparés"],
  ['ENTREPRISE_GENERALE', 'Entreprise générale'],
  ['MANDAT_ARCHITECTE', "Mandat d'architecte"],
] as const;

const CANTONS = ['VD', 'GE', 'VS', 'FR', 'NE', 'JU', 'BE'];

/**
 * Création d'une promotion.
 *
 * Seul le nom est exigé — le reste se complète en route. Un promoteur qui
 * ouvre un dossier ne connaît pas encore ses droits de mutation, et lui
 * imposer de tout renseigner d'un coup le pousserait à saisir des valeurs
 * fausses pour passer l'écran.
 *
 * `commercialisationActive` est cochée par défaut : c'est le cas d'un
 * promoteur. La décocher réserve la promotion à la gestion de chantier — le
 * cas d'un mandat piloté pour un maître d'ouvrage tiers.
 */
export function FormulairePromotion() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);

    const donnees = new FormData(event.currentTarget);
    const texte = (cle: string) => {
      const v = String(donnees.get(cle) ?? '').trim();
      return v === '' ? undefined : v;
    };

    try {
      const res = await fetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: texte('nom'),
          description: texte('description'),
          commune: texte('commune'),
          canton: texte('canton'),
          parcelle: texte('parcelle'),
          statut: texte('statut'),
          modeRealisation: texte('modeRealisation'),
          dateDebut: texte('dateDebut'),
          dateLivraisonPrevue: texte('dateLivraisonPrevue'),
          // Les montants partent en CHAÎNES : convertis en nombre ici, ils
          // perdraient de la précision avant même d'atteindre le Decimal.
          prixTerrain: texte('prixTerrain'),
          fraisNotaireTerrain: texte('fraisNotaireTerrain'),
          droitsMutation: texte('droitsMutation'),
          commercialisationActive: donnees.get('commercialisationActive') === 'on',
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { id?: number; message?: string };
      if (!res.ok) {
        setErreur(
          Array.isArray(data.message)
            ? data.message.join(' · ')
            : (data.message ?? 'Création impossible.'),
        );
        return;
      }

      router.push(`/operations/${data.id}`);
      router.refresh();
    } catch {
      setErreur("L'API est injoignable.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Nom de la promotion
        <input name="nom" type="text" required autoFocus placeholder="Les Terrasses du Coteau" />
      </label>

      <div className="grille-2">
        <label>
          Commune
          <input name="commune" type="text" placeholder="Prilly" />
        </label>
        <label>
          Canton
          <select name="canton" defaultValue="VD">
            {CANTONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Parcelles
        <input name="parcelle" type="text" placeholder="2841, 2842" />
      </label>

      <div className="grille-2">
        <label>
          Statut
          <select name="statut" defaultValue="MONTAGE">
            {STATUTS.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode de réalisation
          <select name="modeRealisation" defaultValue="CORPS_DETAT_SEPARES">
            {MODES.map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grille-2">
        <label>
          Début des travaux
          <input name="dateDebut" type="date" />
        </label>
        <label>
          Livraison prévue
          <input name="dateLivraisonPrevue" type="date" />
        </label>
      </div>

      <p className="note">
        Le foncier est enregistré <strong>sur la promotion</strong>. Il n&apos;alimente pas le bilan
        promoteur tout seul : celui-ci lit le budget CFC. Ces montants sont donc à reporter au
        groupe 0 du budget pour apparaître dans les coûts.
      </p>

      <div className="grille-3">
        <label>
          Prix du terrain
          <input name="prixTerrain" type="text" inputMode="decimal" placeholder="3200000" />
        </label>
        <label>
          Frais de notaire
          <input name="fraisNotaireTerrain" type="text" inputMode="decimal" placeholder="58000" />
        </label>
        <label>
          Droits de mutation
          <input name="droitsMutation" type="text" inputMode="decimal" placeholder="105600" />
        </label>
      </div>

      <label className="case">
        <input name="commercialisationActive" type="checkbox" defaultChecked />
        <span>
          Commercialisation active
          <span className="meta">
            Décocher pour un chantier piloté pour un maître d&apos;ouvrage tiers : ni lots, ni
            acquéreurs, ni appels de fonds.
          </span>
        </span>
      </label>

      <label>
        Description
        <input name="description" type="text" placeholder="Deux immeubles en PPE, vente sur plan" />
      </label>

      {erreur && <p className="ko">{erreur}</p>}

      <button type="submit" disabled={enCours}>
        {enCours ? 'Création…' : 'Créer la promotion'}
      </button>
    </form>
  );
}
