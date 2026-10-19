'use client';

import { useEnvoi } from '../../../components/formulaire';

/**
 * Tirer les zones du texte — ou les retirer à nouveau.
 *
 * Une relecture remplace les zones précédentes : garder les anciennes à
 * côté des nouvelles ferait cohabiter deux vérités pour la même commune.
 */
export function ExtraireZones({ reglementId, relu }: { reglementId: number; relu: boolean }) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <>
      <button
        type="button"
        disabled={enCours}
        onClick={() => void envoyer(`/communes/reglements/${reglementId}/zones`, {}, 'POST')}
      >
        {enCours ? 'Lecture en cours…' : relu ? 'Relire les zones' : 'Tirer les zones du règlement'}
      </button>
      {enCours && (
        <p className="note">
          Le modèle lit le tableau des zones. Comptez une trentaine de secondes.
        </p>
      )}
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}

/**
 * Valider une zone : le geste qui la rend utilisable.
 *
 * Tant qu'il n'a pas eu lieu, l'écran Foncier affiche la zone comme
 * « proposée, à vérifier ». C'est volontaire : un indice tiré d'un OCR par
 * un modèle décide d'un achat de terrain, et personne ne doit pouvoir dire
 * plus tard qu'il ne savait pas d'où venait le chiffre.
 */
export function ValiderZone({
  zoneId,
  valide,
}: {
  zoneId: number;
  valide: boolean;
}) {
  const { envoyer, erreur, enCours } = useEnvoi();
  return (
    <>
      <button
        type="button"
        className="lien"
        disabled={enCours}
        onClick={() => void envoyer(`/communes/zones/${zoneId}/valider`, { valide: !valide }, 'POST')}
      >
        {enCours ? '…' : valide ? 'retirer la validation' : 'Valider'}
      </button>
      {erreur && <p className="ko">{erreur}</p>}
    </>
  );
}
