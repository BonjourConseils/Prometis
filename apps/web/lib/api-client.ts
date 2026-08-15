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
 * Vide les chaînes en `undefined`.
 *
 * Un champ laissé vide doit être **absent** du corps, pas envoyé comme
 * chaîne vide : zod refuserait une chaîne vide là où il accepte l'absence.
 */
export function champ(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? '').trim();
  return texte === '' ? undefined : texte;
}
