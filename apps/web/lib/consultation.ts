import { cookies } from 'next/headers';

/**
 * La session de l'espace entreprise : un cookie à part, jamais celui des
 * comptes Prometis.
 *
 * `SameSite=Strict` : aucune requête venue d'un autre site ne le porte — le
 * relais ne peut pas servir de proxy authentifié à une page tierce. Deux
 * heures, comme la session qu'il contient.
 */
export const COOKIE_CONSULTATION = 'prometis_consultation';
export const DUREE_CONSULTATION = 60 * 60 * 2;

/** Le même contrôle que l'API : rien d'autre n'est relayé. */
export function jetonValide(jeton: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(jeton);
}

export async function sessionConsultation(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_CONSULTATION)?.value;
}
