'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi, champ } from '../../../../lib/api-client';
import { Repliable, useEnvoi } from '../../../components/formulaire';

const CATEGORIES = [
  ['CHAUFFAGE', 'Chauffage'],
  ['VENTILATION', 'Ventilation'],
  ['SANITAIRE', 'Sanitaire'],
  ['ELECTRICITE', 'Électricité'],
  ['PHOTOVOLTAIQUE', 'Photovoltaïque'],
  ['ASCENSEUR', 'Ascenseur'],
  ['CUISINE', 'Cuisine'],
  ['MENUISERIE', 'Menuiserie'],
  ['TOITURE', 'Toiture'],
  ['FACADE', 'Façade'],
  ['SECURITE', 'Sécurité'],
  ['AMENAGEMENTS_EXTERIEURS', 'Aménagements extérieurs'],
  ['AUTRE', 'Autre'],
] as const;

const nombre = (v: FormDataEntryValue | null) => {
  const s = champ(v);
  return s === undefined ? undefined : Number(s);
};

/** Saisir un équipement à la main — le chemin qui marche toujours, IA ou pas. */
export function AjouterEquipement({
  operationId,
  lots,
  contrats,
}: {
  operationId: number;
  lots: { id: number; libelle: string }[];
  contrats: { id: number; libelle: string }[];
}) {
  return (
    <Repliable libelle="Ajouter un équipement">
      {(fermer) => (
        <FormulaireEquipement
          operationId={operationId}
          lots={lots}
          contrats={contrats}
          fermer={fermer}
        />
      )}
    </Repliable>
  );
}

function FormulaireEquipement({
  operationId,
  lots,
  contrats,
  fermer,
}: {
  operationId: number;
  lots: { id: number; libelle: string }[];
  contrats: { id: number; libelle: string }[];
  fermer: () => void;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const ok = await envoyer(`/operations/${operationId}/passeport/equipements`, {
      categorie: champ(d.get('categorie')),
      designation: champ(d.get('designation')),
      marque: champ(d.get('marque')),
      modele: champ(d.get('modele')),
      numeroSerie: champ(d.get('numeroSerie')),
      emplacement: champ(d.get('emplacement')),
      lotId: nombre(d.get('lotId')),
      contratId: nombre(d.get('contratId')),
      dateMiseEnService: champ(d.get('dateMiseEnService')),
      garantieFabricantFin: champ(d.get('garantieFabricantFin')),
      entretienPeriodiciteMois: nombre(d.get('entretienPeriodiciteMois')),
    });
    if (ok) fermer();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <div className="grille-3">
        <label>
          Catégorie
          <select name="categorie" defaultValue="CHAUFFAGE">
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Désignation
          <input name="designation" required placeholder="Pompe à chaleur air-eau" />
        </label>
        <label>
          Emplacement
          <input name="emplacement" placeholder="Local technique, sous-sol" />
        </label>
        <label>
          Marque
          <input name="marque" />
        </label>
        <label>
          Modèle
          <input name="modele" />
        </label>
        <label>
          N° de série
          <input name="numeroSerie" />
        </label>
        <label>
          Lot
          <select name="lotId" defaultValue="">
            <option value="">— parties communes —</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Posé sous le contrat
          <select name="contratId" defaultValue="">
            <option value="">— aucun —</option>
            {contrats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mise en service
          <input name="dateMiseEnService" type="date" />
        </label>
        <label>
          Garantie fabricant jusqu&apos;au
          <input name="garantieFabricantFin" type="date" />
        </label>
        <label>
          Entretien tous les … mois
          <input name="entretienPeriodiciteMois" type="number" min={1} max={120} />
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Ajouter'}
      </button>
    </form>
  );
}

/** Valider ou rejeter une proposition de l'IA. */
export function TraiterProposition({
  operationId,
  equipementId,
}: {
  operationId: number;
  equipementId: number;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  const base = `/operations/${operationId}/passeport/equipements/${equipementId}`;
  return (
    <div className="actions">
      <button
        type="button"
        className="principal"
        disabled={enCours}
        onClick={() => envoyer(`${base}/valider`, {})}
      >
        Valider
      </button>
      <button type="button" disabled={enCours} onClick={() => envoyer(`${base}/rejeter`)}>
        Rejeter
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </div>
  );
}

/**
 * Lancer la lecture d'un document par l'IA.
 *
 * Le résultat est dit en entier — combien de propositions, combien écartées
 * parce que leur citation ne figurait pas dans le document. Taire les
 * écartées laisserait croire que l'IA n'a rien vu.
 */
export function Proposer({
  operationId,
  documents,
}: {
  operationId: number;
  documents: { id: number; libelle: string }[];
}) {
  const router = useRouter();
  const [resultat, setResultat] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const documentId = Number(new FormData(event.currentTarget).get('documentId'));
    setErreur(null);
    setResultat(null);
    setEnCours(true);
    const res = await appelApi<{ proposees: number; ecartees: number }>(
      `/operations/${operationId}/passeport/propositions`,
      { methode: 'POST', corps: { documentId } },
    );
    setEnCours(false);
    if (!res.ok) {
      setErreur(res.erreur ?? 'Lecture impossible.');
      return;
    }
    const { proposees, ecartees } = res.data;
    setResultat(
      `${proposees} équipement(s) proposé(s), à valider ci-dessus` +
        (ecartees > 0
          ? ` · ${ecartees} écarté(s) : leur citation ne figure pas dans le document.`
          : '.'),
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <label>
        Document
        <select name="documentId" defaultValue={documents[0]?.id}>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.libelle}
            </option>
          ))}
        </select>
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      {resultat && <p className="ok">{resultat}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Lecture en cours — jusqu’à une minute…' : 'Proposer les équipements'}
      </button>
    </form>
  );
}
