'use client';

/**
 * Appels à l'API depuis un composant client, via le relais serveur.
 *
 * Aucun composant client ne parle à l'API en direct : le jeton est dans un
 * cookie httpOnly qu'il ne peut pas lire. Tout passe par `/api/prometis/…`,
 * qui rattache l'autorisation côté serveur.
 */

export interface Echec {
  message: string;
}

/** Ce que Nest renvoie sur une erreur de validation zod : un tableau de messages. */
function messageLisible(data: unknown, defaut: string): string {
  const message = (data as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(' · ');
  if (typeof message === 'string') return message;
  return defaut;
}

export async function appelApi<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown } = {},
): Promise<{ ok: boolean; statut: number; data: T; erreur?: string }> {
  try {
    const res = await fetch(`/api/prometis${chemin}`, {
      method: options.methode ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
    });
    const data = (await res.json().catch(() => ({}))) as T;

    return res.ok
      ? { ok: true, statut: res.status, data }
      : {
          ok: false,
          statut: res.status,
          data,
          erreur: messageLisible(data, `L'API a répondu ${res.status}.`),
        };
  } catch {
    return {
      ok: false,
      statut: 0,
      data: {} as T,
      erreur: "L'API est injoignable.",
    };
  }
}

/**
 * Téléverse un fichier — le PDF d'une facture, aujourd'hui.
 *
 * Le `Content-Type` n'est **pas** posé à la main : le navigateur doit le
 * calculer lui-même pour y placer la frontière du multipart. L'écrire ici
 * produirait un en-tête sans frontière, et un corps que l'API ne saurait pas
 * découper.
 */
export async function televerser<T>(
  chemin: string,
  fichier: File,
  // Métadonnées envoyées dans le même multipart — le titre et la catégorie
  // d'un document, par exemple. Les valeurs `undefined` sont omises : zod
  // doit voir une absence, pas la chaîne « undefined ».
  metadonnees: Record<string, string | boolean | number | undefined> = {},
  champFichier = 'fichier',
): Promise<{ ok: boolean; statut: number; data: T; erreur?: string }> {
  const formulaire = new FormData();
  formulaire.append(champFichier, fichier);
  for (const [cle, valeur] of Object.entries(metadonnees)) {
    if (valeur !== undefined) formulaire.append(cle, String(valeur));
  }

  try {
    const res = await fetch(`/api/prometis${chemin}`, { method: 'POST', body: formulaire });
    const data = (await res.json().catch(() => ({}))) as T;

    return res.ok
      ? { ok: true, statut: res.status, data }
      : {
          ok: false,
          statut: res.status,
          data,
          erreur: messageLisible(data, `L'API a répondu ${res.status}.`),
        };
  } catch {
    return { ok: false, statut: 0, data: {} as T, erreur: "L'API est injoignable." };
  }
}

/**
 * Vide les chaînes en `undefined`.
 *
 * Un champ laissé vide doit être **absent** du corps, pas envoyé comme
 * chaîne vide : zod refuserait une chaîne vide là où il accepte l'absence.
 */
export function champ(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? '').trim();
  return texte === '' ? undefined : texte;
}
