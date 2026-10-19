'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi, champ } from '../../lib/api-client';
import { useEnvoi } from '../components/formulaire';

/** Les cantons romands d'abord : ce sont ceux où l'on construit. */
const CANTONS = ['VS', 'VD', 'GE', 'FR', 'NE', 'JU', 'BE', 'ZH', 'TI'];

export function AjouterCommune() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    setErreur(null);
    setEnCours(true);
    const r = await appelApi('/communes', {
      methode: 'POST',
      corps: { nom: champ(d.get('nom')), canton: champ(d.get('canton')) },
    });
    setEnCours(false);
    if (!r.ok) {
      setErreur(r.erreur ?? 'Création impossible.');
      return;
    }
    setOuvert(false);
    router.refresh();
  }

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        Ajouter une commune
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="grille">
        <label>
          Commune
          <input name="nom" required placeholder="Martigny" autoFocus />
        </label>
        <label>
          Canton
          <select name="canton" required defaultValue="VS">
            {CANTONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Ajouter la commune'}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </form>
  );
}

/**
 * Enregistrer le règlement d'une commune : son lien, son fichier, ou les deux.
 *
 * Les deux se gardent volontiers — un lien communal meurt (refonte de site,
 * PDF renommé) alors qu'une promotion dure trois ans. Le fichier déposé est
 * la pièce qu'on pourra relire ; le lien dit d'où elle vient.
 */
export function AjouterReglement({ communeId, nom }: { communeId: number; nom: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = event.currentTarget;
    const d = new FormData(formulaire);
    const fichier = d.get('fichier');
    const url = champ(d.get('url'));
    if (!url && !(fichier instanceof File && fichier.size > 0)) {
      setErreur('Donnez un lien vers le règlement, ou déposez son fichier.');
      return;
    }

    setErreur(null);
    setEnCours(true);
    const cree = await appelApi<{ id: number }>(`/communes/${communeId}/reglements`, {
      methode: 'POST',
      corps: {
        titre: champ(d.get('titre')) ?? 'Règlement des constructions et des zones (RCCZ)',
        version: champ(d.get('version')),
        url,
      },
    });
    if (!cree.ok || !cree.data) {
      setEnCours(false);
      setErreur(cree.erreur ?? 'Enregistrement impossible.');
      return;
    }

    // Le fichier part dans un second appel : il voyage en multipart, pas en
    // JSON, et le règlement doit exister pour porter sa clé de stockage.
    if (fichier instanceof File && fichier.size > 0) {
      const corps = new FormData();
      corps.append('fichier', fichier);
      const envoi = await fetch(`/api/prometis/communes/reglements/${cree.data.id}/fichier`, {
        method: 'POST',
        body: corps,
      });
      if (!envoi.ok) {
        setEnCours(false);
        setErreur('Le règlement est enregistré, mais le fichier n’a pas été accepté.');
        router.refresh();
        return;
      }
    }

    setEnCours(false);
    setOuvert(false);
    router.refresh();
  }

  if (!ouvert) {
    return (
      <button type="button" className="lien" onClick={() => setOuvert(true)}>
        Enregistrer un règlement
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="note">
        Le règlement de {nom} — son lien sur le site communal, son PDF, ou les deux.
      </p>
      <div className="grille">
        <label>
          Titre
          <input
            name="titre"
            defaultValue="Règlement communal des constructions et des zones (RCCZ)"
          />
        </label>
        <label>
          Version
          <input name="version" placeholder="2024" />
        </label>
      </div>
      <label>
        Lien public
        <input name="url" inputMode="url" placeholder="https://www.commune.ch/…/rccz.pdf" />
      </label>
      <label>
        Fichier PDF
        <input type="file" name="fichier" accept="application/pdf" />
      </label>
      {erreur && <p className="ko">{erreur}</p>}
      <button type="submit" disabled={enCours}>
        {enCours ? 'Enregistrement…' : 'Enregistrer le règlement'}
      </button>{' '}
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </form>
  );
}

/**
 * Lire le règlement : en extraire le texte.
 *
 * Un RCCZ est très souvent un scan. Beaucoup de photocopieurs appliquent
 * leur propre OCR en numérisant, et la couche texte suffit alors ; sinon la
 * chaîne OCR de l'app prend le relais. L'écran dit ensuite laquelle a servi,
 * parce qu'un texte océrisé porte des fautes dont il faut se souvenir en
 * relisant une valeur douteuse.
 */
export function LireReglement({ reglementId, relu }: { reglementId: number; relu: boolean }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => void envoyer(`/communes/reglements/${reglementId}/lire`, {}, 'POST')}
      >
        {enCours ? 'Lecture…' : relu ? 'Relire' : 'Lire le règlement'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
