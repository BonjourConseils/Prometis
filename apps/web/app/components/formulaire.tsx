'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { appelApi } from '../../lib/api-client';

/**
 * Mécanique commune à tous les formulaires de saisie.
 *
 * Les écrans du fil rouge saisissent tous de la même façon : un bouton qui
 * déplie un formulaire, un envoi à l'API, puis `router.refresh()` — c'est le
 * rendu serveur qui relit la base, donc l'écran montre ce qui est
 * réellement enregistré, pas un état local qu'on croirait à jour.
 *
 * Ce module existe parce que la troisième copie du même code aurait été
 * celle de trop : trois gestions d'erreur divergentes pour trois écrans du
 * même parcours, c'est ainsi qu'un formulaire finit par avaler une erreur
 * que les deux autres affichent.
 */
export function Repliable({
  libelle,
  children,
}: {
  libelle: string;
  children: (fermer: () => void) => ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}>
        {libelle}
      </button>
    );
  }
  return (
    <div className="saisie">
      {children(() => setOuvert(false))}
      <button type="button" className="lien" onClick={() => setOuvert(false)}>
        Annuler
      </button>
    </div>
  );
}

/**
 * Envoi d'un formulaire.
 *
 * Rend `false` en cas d'échec — c'est ce qui permet à l'appelant de garder
 * le formulaire ouvert, avec la saisie de l'utilisateur, plutôt que de la
 * jeter au premier refus de l'API.
 */
export function useEnvoi() {
  const router = useRouter();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const envoyer = async (
    chemin: string,
    corps?: unknown,
    methode: string = 'POST',
  ): Promise<boolean> => {
    setErreur(null);
    setEnCours(true);
    const res = await appelApi(chemin, { methode, corps });
    setEnCours(false);

    if (!res.ok) {
      setErreur(res.erreur ?? 'Opération impossible.');
      return false;
    }
    router.refresh();
    return true;
  };

  return { envoyer, erreur, enCours };
}
