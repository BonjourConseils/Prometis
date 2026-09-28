/**
 * L'étage local : Qwen 3.5 4B servi par Ollama sur notre serveur.
 *
 * Pour ce qui est simple et répétitif — trier un e-mail entrant, deviner un
 * corps de métier, étiqueter un document. Deux raisons, et la seconde compte
 * davantage :
 *
 *   · l'appel ne coûte rien de plus que la mémoire déjà payée ;
 *   · **rien ne quitte le serveur** — un e-mail reçu porte des noms, des
 *     montants, parfois un IBAN, et il n'a aucune raison d'être lu ailleurs.
 *
 * L'API est compatible OpenAI : même code d'appel, autre adresse. Absente, la
 * configuration rend `null` et l'appelant retombe sur l'étage suisse, en le
 * journalisant tel qu'il a réellement eu lieu (skill `vps-docker-ia-locale`).
 */

type Env = Record<string, string | undefined>;

export const MODELE_LOCAL = 'qwen3.5:4b';

export interface ConfigOllama {
  baseURL: string;
  modele: string;
  /** Fenêtre de contexte : par défaut, Ollama la réduit et rend des champs nuls. */
  numCtx: number;
}

export function configOllama(env: Env = process.env): ConfigOllama | null {
  const base = env.OLLAMA_URL?.trim();
  if (!base) return null;
  return {
    baseURL: base.replace(/\/+$/, ''),
    modele: env.OLLAMA_MODELE?.trim() || MODELE_LOCAL,
    numCtx: Number(env.OLLAMA_NUM_CTX ?? 8192) || 8192,
  };
}
