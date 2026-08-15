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

  // --- Second facteur (MFA) --------------------------------------------
  /**
   * Clé de chiffrement des secrets TOTP, **hors de la base**.
   *
   * Un secret TOTP ne peut pas être haché : il faut le relire pour vérifier
   * un code. Il est donc chiffré, et la clé vit ici — de sorte qu'une copie
   * du dump ne suffise pas à fabriquer les codes de quelqu'un.
   *
   * Absente, l'enrôlement est refusé plutôt que stocké en clair. 32
   * caractères minimum, aléatoires : `openssl rand -base64 48`.
   */
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Nom affiché dans l'application d'authentification. */
  MFA_ISSUER: z.string().default('Prometis'),
  /**
   * Durée du jeton de défi, entre le mot de passe et le code.
   * Court : il ne sert qu'à saisir six chiffres.
   */
  MFA_DEFI_EXPIRES_IN: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)$/, 'Durée attendue au format « 5m ».')
    .default('5m'),

  // --- Messagerie ------------------------------------------------------
  /**
   * `console` journalise le message sans rien envoyer — c'est le défaut, et il
   * permet de travailler sans identifiants SMTP. `smtp` envoie réellement.
   */
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Prometis <noreply@prometis.ch>'),
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
   * `local` écrit sous `STOCKAGE_LOCAL_DIR` — le défaut en développement, et
   * **refusé en production** : le disque d'un conteneur n'est pas durable,
   * la GED y perdrait ses pièces au premier redéploiement.
   *
   * `s3` vise l'object storage Infomaniak (compatible S3, données en
   * Suisse) — c'est le transport de production.
   */
  STOCKAGE_TRANSPORT: z.enum(['local', 's3']).default('local'),
  STOCKAGE_LOCAL_DIR: z.string().default('./var/documents'),

  /**
   * Point d'accès S3, par exemple `https://s3.pub1.infomaniak.cloud`.
   *
   * Un fournisseur autre qu'AWS impose l'adressage par chemin
   * (`endpoint/bucket/cle`) : les sous-domaines par bucket supposent un
   * certificat générique qu'ils n'ont pas.
   */
  S3_ENDPOINT: z.string().url().or(z.literal('')).optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // --- Extraction du texte des factures (OCR) --------------------------
  /**
   * `absent` — défaut : l'analyse fonctionne sur un texte fourni à la main.
   * `local`  — appelle un binaire du serveur. **Auto-hébergé, délibérément** :
   * une facture porte le nom d'un fournisseur et ses montants ; déléguer
   * l'étape à un service en ligne poserait une question nLPD à chaque pièce.
   */
  OCR_TRANSPORT: z.enum(['absent', 'local']).default('absent'),
  /**
   * Binaire d'extraction. `pdftotext` (poppler) suffit aux PDF déjà
   * textuels ; pour des scans, pointer sur `ocrmypdf` ou `tesseract`.
   */
  OCR_COMMANDE: z.string().default('pdftotext'),
  /** Arguments, séparés par des virgules. `{fichier}` reçoit le chemin du PDF. */
  OCR_ARGUMENTS: z.string().default('-layout,{fichier},-'),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

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
