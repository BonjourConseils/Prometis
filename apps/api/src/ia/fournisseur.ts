/**
 * Le fournisseur d'IA de Prometis : **Infomaniak AI Services**, et lui seul.
 *
 * Hébergé en Suisse, requêtes ni conservées ni utilisées pour l'entraînement.
 * Repris du module de référence de My New Job AI (skill `infomaniak-ai`), à
 * une différence près, délibérée : **pas de commutateur vers OpenAI**.
 * Prometis n'a jamais envoyé une donnée à OpenAI ; ajouter ce chemin « pour un
 * retour arrière » ferait exister un sous-traitant américain que personne n'a
 * décidé, et que les documents publiés devraient nommer.
 *
 * Fonctions pures, testées : tout ce qui diffère d'une requête OpenAI vit ici.
 */

type Env = Record<string, string | undefined>;

/** Identifiants relevés le 18.09.2026, page « open-source models ». */
export const MODELES = {
  qwen122: 'Qwen/Qwen3.5-122B-A10B-FP8',
  qwen397: 'Qwen/Qwen3.5-397B-A17B-FP8',
  mistralSmall4: 'mistralai/Mistral-Small-4-119B-2603',
  apertus70: 'swiss-ai/Apertus-v1.5-70B',
} as const;

/** CHF par million de tokens — relu sur la page tarifaire avant de le changer. */
export const TARIFS: Record<string, { entree: number; sortie: number }> = {
  [MODELES.qwen122]: { entree: 0.4, sortie: 3.2 },
  [MODELES.qwen397]: { entree: 0.8, sortie: 3.6 },
  [MODELES.mistralSmall4]: { entree: 0.2, sortie: 0.75 },
  [MODELES.apertus70]: { entree: 0.7, sortie: 2.5 },
};

export interface ConfigFournisseur {
  apiKey: string;
  baseURL: string;
  modele: string;
}

/**
 * La configuration, ou `null` si l'IA n'est pas configurée sur ce serveur.
 *
 * `null` et pas une exception : sans IA, le passeport fonctionne — on saisit
 * les équipements à la main. Seule la proposition automatique s'éteint, et
 * l'écran le dit.
 */
export function configFournisseur(env: Env = process.env): ConfigFournisseur | null {
  const apiKey = env.INFOMANIAK_AI_TOKEN?.trim();
  const productId = env.INFOMANIAK_AI_PRODUCT_ID?.trim();
  if (!apiKey || !productId) return null;
  return {
    apiKey,
    baseURL: `https://api.infomaniak.com/2/ai/${productId}/openai/v1`,
    modele: env.INFOMANIAK_AI_MODEL?.trim() || MODELES.qwen122,
  };
}

/**
 * Adapte une requête Chat Completions à Infomaniak. Les cinq adaptations,
 * toutes constatées en réel sur My New Job AI :
 *
 * - le modèle est **imposé** : un nom `gpt-*` ferait échouer l'appel ;
 * - `max_tokens` devient `max_completion_tokens` ;
 * - `json_object` est refusé (400) → traduit en un `json_schema` permissif ;
 * - `reasoning_effort: "none"` si l'appelant n'en donne pas — sinon le
 *   *thinking* est actif : latence multipliée, tokens de raisonnement
 *   facturés, et du texte hors JSON ;
 * - les paramètres de cache propres à OpenAI sont retirés.
 */
export function adapterRequete(
  params: Record<string, unknown>,
  modele: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params, model: modele };

  if ('max_tokens' in out) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }

  const format = out.response_format as { type?: string } | undefined;
  if (format?.type === 'json_object') {
    out.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', schema: { type: 'object', additionalProperties: true } },
    };
  }

  if (out.reasoning_effort == null) out.reasoning_effort = 'none';

  delete out.prompt_cache_key;
  delete out.prompt_cache_retention;
  return out;
}

/** Coût estimé en millièmes de franc ; `null` pour un modèle sans tarif connu. */
export function coutMilliemes(modele: string, entree: number, sortie: number): number | null {
  const tarif = TARIFS[modele];
  if (!tarif) return null;
  const chf = (entree * tarif.entree + sortie * tarif.sortie) / 1_000_000;
  return Math.round(chf * 1000);
}

/**
 * Retire du texte ce qui identifie une personne avant de l'envoyer.
 *
 * Infomaniak est en Suisse et ne conserve rien — mais la localisation règle le
 * transfert, pas la minimisation. Une notice d'équipement n'a pas besoin d'un
 * e-mail, d'un numéro de téléphone ou d'un IBAN pour dire ce qu'est une
 * chaudière. Un PV de réception, lui, en porte.
 */
export function masquer(texte: string): string {
  return texte
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail]')
    .replace(/\bCH\d{2}(?:\s?[0-9A-Z]{4}){4}\s?[0-9A-Z]\b/gi, '[IBAN]')
    .replace(/(?:\+41|0041|\b0)\s?\d{2}\s?\d{3}\s?\d{2}\s?\d{2}\b/g, '[téléphone]');
}
