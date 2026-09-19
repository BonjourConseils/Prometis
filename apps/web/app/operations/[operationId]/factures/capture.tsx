'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Resultat {
  fichier: string;
  statut: 'recue' | 'doublon' | 'refusee';
  factureId?: number;
  raison?: string;
}

/**
 * Déposer des factures : glisser-déposer, sélection multiple, ou photo prise
 * au téléphone. Une seule porte, un seul chemin : chaque pièce est vérifiée,
 * dédoublonnée, conservée, puis lue en arrière-plan. Le résultat se dit pièce
 * par pièce — un doublon renvoie vers la facture existante, un refus dit
 * pourquoi.
 */
export function ZoneDepot({ operationId }: { operationId: number }) {
  const router = useRouter();
  const [survol, setSurvol] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [resultats, setResultats] = useState<Resultat[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichiers = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);

  async function envoyer(liste: FileList | File[], source: 'UPLOAD' | 'CAMERA') {
    const pieces = Array.from(liste);
    if (!pieces.length) return;
    setEnCours(true);
    setErreur(null);
    const form = new FormData();
    form.append('source', source);
    for (const f of pieces) form.append('fichiers', f);
    try {
      const res = await fetch(`/api/prometis/operations/${operationId}/factures/depots`, {
        method: 'POST',
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        resultats?: Resultat[];
        message?: string;
      };
      if (!res.ok) setErreur(data.message ?? `Dépôt refusé (${res.status}).`);
      else setResultats(data.resultats ?? []);
    } catch {
      setErreur('Service injoignable.');
    }
    setEnCours(false);
    router.refresh();
  }

  function deposer(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setSurvol(false);
    void envoyer(e.dataTransfer.files, 'UPLOAD');
  }

  return (
    <div className="zone-depot-bloc">
      <div
        className={`zone-depot${survol ? ' survol' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={deposer}
        role="button"
        tabIndex={0}
        onClick={() => fichiers.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fichiers.current?.click()}
      >
        <strong>{enCours ? 'Envoi…' : 'Déposez vos factures ici'}</strong>
        <span className="meta">
          ou cliquez pour les choisir — PDF, JPEG, PNG · plusieurs à la fois · 25 Mo au plus
        </span>
      </div>
      <input
        ref={fichiers}
        type="file"
        multiple
        hidden
        accept="application/pdf,image/jpeg,image/png,image/tiff"
        onChange={(e) => e.target.files && void envoyer(e.target.files, 'UPLOAD')}
      />
      <input
        ref={photo}
        type="file"
        multiple
        hidden
        accept="image/*"
        capture="environment"
        onChange={(e) => e.target.files && void envoyer(e.target.files, 'CAMERA')}
      />
      <button type="button" onClick={() => photo.current?.click()} disabled={enCours}>
        Photographier une facture
      </button>
      {erreur && <p className="ko">{erreur}</p>}
      {resultats.length > 0 && (
        <ul className="resultats-depot">
          {resultats.map((r, i) => (
            <li
              key={i}
              className={r.statut === 'refusee' ? 'ko' : r.statut === 'doublon' ? 'meta' : 'ok'}
            >
              {r.fichier} — {r.statut === 'recue' && 'reçue, lecture en cours'}
              {r.statut === 'doublon' && (
                <>
                  déjà reçue :{' '}
                  <Link href={`/operations/${operationId}/factures/${r.factureId}`}>
                    voir la facture
                  </Link>
                </>
              )}
              {r.statut === 'refusee' && `refusée : ${r.raison}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tant qu'une facture est en lecture, la page se rafraîchit seule : la
 * personne retrouve sa facture où qu'elle soit allée entre-temps (leçon de
 * Fristo, « le fil perdu »).
 */
export function RafraichirPendantLecture({ actif }: { actif: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [actif, router]);
  return null;
}
