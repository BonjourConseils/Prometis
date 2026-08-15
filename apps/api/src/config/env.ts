import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Charge le `.env` de la racine du monorepo.
 *
 * On remonte l'arborescence plutôt que de coder un chemin relatif en dur :
 * `nest start` et `node dist/main.js` n'ont pas le même répertoire courant, et
 * un chemin figé casse dès qu'on déplace le dossier de build.
 */
export function loadRootEnv(from: string = __dirname): void {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Pas de .env : on continue — en conteneur, les variables viennent de
  // l'environnement, et loadEnv() refusera de booter si l'essentiel manque.
}

/**
 * Validation de l'environnement au démarrage : mieux vaut refuser de booter
 * qu'ouvrir une connexion avec une URL vide.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Rôle APPLICATIF (`prometis_app`), soumis à la Row-Level Security.
   * Ne jamais y mettre l'URL du rôle propriétaire : il contournerait la RLS.
   */
  DATABASE_URL: z.string().min(1),

  /**
   * Secret de signature des jetons. 32 caractères minimum — un secret court
   * se force hors ligne, et le jeton porte le tenant.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères.'),
  // Format `ms` : « 30m », « 8h », « 7d ». Validé ici pour que le cast vers
  // le type attendu par @nestjs/jwt repose sur une valeur déjà contrôlée.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)$/, 'Durée attendue au format « 8h », « 30m », « 7d ».')
    .default('8h'),

  // --- Messagerie ------------------------------------------------------
  /**
   * `console` journalise le message sans rien envoyer — c'est le défaut, et il
   * permet de travailler sans identifiants SMTP. `smtp` envoie réellement.
   */
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Prometis <ne-pas-repondre@prometis.ch>'),
  /**
   * Adresse unique qui reçoit TOUS les e-mails hors production.
   *
   * Obligatoire hors production : sans elle, `MailService` refuse d'envoyer.
   * C'est ce qui garantit qu'aucun appel de fonds ne parte chez un vrai
   * acquéreur pendant le développement.
   */
  MAIL_REDIRECT_TO: z.string().email().or(z.literal('')).optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => v === true || v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // --- Stockage des documents (GED) ------------------------------------
  /**
   * `local` écrit sous `STOCKAGE_LOCAL_DIR` — le défaut, et le seul
   * implémenté : il permet de développer et de tester la GED sans compte
   * object storage. Refusé en production, où le disque d'un conteneur n'est
   * pas un stockage durable.
   *
   * `s3` est déclaré mais lève : choisir l'hébergeur (Exoscale, Infomaniak)
   * engage la localisation des données au sens de la nLPD.
   */
  STOCKAGE_TRANSPORT: z.enum(['local', 's3']).default('local'),
  STOCKAGE_LOCAL_DIR: z.string().default('./var/documents'),

  // --- Passerelle Kolabimo ---------------------------------------------
  /**
   * Base de l'API v1 de Kolabimo, par exemple `https://app.kolabimo.ch`.
   *
   * Absente, la passerelle reste **installée mais silencieuse** : les
   * événements sortants sont écrits en boîte d'envoi et attendent d'être
   * rejoués. Rien ne casse, et rien ne part au hasard.
   */
  KOLABIMO_API_URL: z.string().url().or(z.literal('')).optional(),
  /**
   * Clé d'API Kolabimo, qui sert AUSSI de secret de signature des messages
   * que nous lui envoyons — comme la clé Prometis sert de secret aux messages
   * qu'il nous envoie. Symétrique, donc une seule chose à échanger.
   *
   * Limite assumée : une seule clé pour toute l'instance. Le jour où deux
   * sociétés Prometis parleront à deux comptes Kolabimo distincts, il faudra
   * un champ de schéma ou un coffre — cf. `references/roadmap.md`.
   */
  KOLABIMO_API_KEY: z.string().optional(),
  /** Délai d'attente d'un appel sortant vers Kolabimo, en millisecondes. */
  KOLABIMO_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  · ${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n');
    throw new Error(`Environnement invalide :\n${details}`);
  }
  return parsed.data;
}
