'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface WorkspaceItem {
  societeId: number;
  membershipId: number;
  role: string;
  fonction: string | null;
  raisonSociale: string;
  profil: string;
  modulesActifs: string[];
}

const LIBELLE_PROFIL: Record<string, string> = {
  PROMOTEUR: 'Promoteur',
  ENTREPRISE_GENERALE: 'Entreprise générale',
  ARCHITECTE: 'Architecte',
  BUREAU_TECHNIQUE: 'Bureau technique',
  REGIE: 'Régie',
  AUTRE: 'Autre',
};

export function WorkspaceList({ workspaces }: { workspaces: WorkspaceItem[] }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function choisir(societeId: number) {
    setErreur(null);
    setEnCours(societeId);
    try {
      const res = await fetch('/api/session/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ societeId }),
      });
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        setErreur((data as { message?: string }).message ?? 'Espace inaccessible.');
        return;
      }
      router.push('/');
      router.refresh();
    } finally {
      setEnCours(null);
    }
  }

  if (workspaces.length === 0) {
    return (
      <p>
        Ce compte n&apos;est membre d&apos;aucune société active. Un administrateur doit lui ouvrir
        un accès.
      </p>
    );
  }

  return (
    <>
      {erreur && <p className="ko">{erreur}</p>}
      <ul className="espaces">
        {workspaces.map((w) => (
          <li key={w.societeId}>
            <button type="button" onClick={() => choisir(w.societeId)} disabled={enCours !== null}>
              <span className="titre">{w.raisonSociale}</span>
              <span className="meta">
                {LIBELLE_PROFIL[w.profil] ?? w.profil} · {w.role.toLowerCase().replace('_', ' ')}
                {w.fonction ? ` · ${w.fonction}` : ''} · {w.modulesActifs.length} modules
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
