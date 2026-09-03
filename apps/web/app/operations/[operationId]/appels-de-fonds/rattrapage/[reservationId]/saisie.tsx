'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { appelApi } from '../../../../../../lib/api-client';
import { chf, montant } from '../../../../../../lib/format';

export interface EtapeAChoisir {
  etapeId: number;
  libelle: string;
  pourcentage: string;
  dateCompletion: string | null;
  montant: string | null;
}

/**
 * Le choix des étapes du premier appel.
 *
 * Rien n'est coché au départ, et c'est délibéré. Une case pré-cochée devient
 * un défaut qu'on valide sans lire — or ce que ce formulaire produit, ce sont
 * des créances envoyées à un acquéreur qui vient peut-être de les régler chez
 * le notaire. Le geste doit être actif.
 *
 * Le total se recalcule à la coche : c'est le seul chiffre qui compte pour la
 * décision, et le lire après coup dans un e-mail parti serait trop tard.
 */
export function ChoisirEtapes({
  operationId,
  reservationId,
  etapes,
}: {
  operationId: number;
  reservationId: number;
  etapes: EtapeAChoisir[];
}) {
  const router = useRouter();
  const [choisies, setChoisies] = useState<Set<number>>(new Set());
  const [envoyer, setEnvoyer] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const basculer = (etapeId: number) => {
    const suivant = new Set(choisies);
    if (suivant.has(etapeId)) suivant.delete(etapeId);
    else suivant.add(etapeId);
    setChoisies(suivant);
  };

  const total = etapes
    .filter((e) => choisies.has(e.etapeId))
    .reduce((t, e) => t + Number(e.montant ?? 0), 0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    setEnCours(true);

    const res = await appelApi(
      `/operations/${operationId}/reservations/${reservationId}/rattrapage`,
      {
        methode: 'POST',
        corps: { etapeIds: [...choisies], envoyer },
      },
    );
    setEnCours(false);

    if (!res.ok) {
      setErreur(res.erreur ?? 'Émission impossible.');
      return;
    }
    router.push(`/operations/${operationId}/appels-de-fonds`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="form">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Jalon</th>
            <th>Terminé le</th>
            <th className="droite">%</th>
            <th className="droite">Montant</th>
          </tr>
        </thead>
        <tbody>
          {etapes.map((e) => (
            <tr key={e.etapeId} className={choisies.has(e.etapeId) ? 'groupe' : ''}>
              <td>
                <input
                  type="checkbox"
                  checked={choisies.has(e.etapeId)}
                  onChange={() => basculer(e.etapeId)}
                  aria-label={`Inclure ${e.libelle}`}
                />
              </td>
              <td>{e.libelle}</td>
              <td>{e.dateCompletion ?? '—'}</td>
              <td className="droite">{e.pourcentage}</td>
              <td className="droite">{e.montant ? montant(e.montant) : '—'}</td>
            </tr>
          ))}
          <tr className="groupe">
            <td></td>
            <td>
              <strong>Total appelé</strong>
            </td>
            <td></td>
            <td></td>
            <td className="droite">
              <strong>{chf(String(total))}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <label className="case">
        <input type="checkbox" checked={envoyer} onChange={(e) => setEnvoyer(e.target.checked)} />
        <span>
          Envoyer les documents aux acquéreurs
          <span className="meta">
            Une lettre et un bordereau QR par étape retenue. Décochez pour créer les créances sans
            rien envoyer — une reprise de données, par exemple.
          </span>
        </span>
      </label>

      {erreur && <p className="ko">{erreur}</p>}

      <button type="submit" className="principal" disabled={enCours || choisies.size === 0}>
        {enCours
          ? 'Émission…'
          : choisies.size === 0
            ? 'Choisir au moins une étape'
            : `Émettre ${choisies.size} appel${choisies.size > 1 ? 's' : ''} — ${chf(String(total))}`}
      </button>
    </form>
  );
}
