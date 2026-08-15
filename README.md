# Prometis

SaaS multi-tenant de gestion de promotions immobilières — Suisse romande.
Du foncier au budget CFC, aux soumissions et adjudications (SIA 118), aux factures lues par
OCR/IA, jusqu'aux appels de fonds envoyés aux acquéreurs.

**Lots 0 à 6 livrés** — le fil rouge financier est complet (`Budgété → Adjugé → Commandé →
Facturé → Payé`, poste CFC par poste CFC) et le moteur d'appels de fonds tourne. Prochain :
passerelle Kolabimo. État détaillé et sujets en attente d'arbitrage :
`.claude/skills/prometis-dev/references/roadmap.md`.

## Démarrer

Prérequis : Node ≥ 22, PostgreSQL ≥ 16, Redis. En local, les services Homebrew
(`postgresql@16`, `redis`) suffisent ; `docker-compose.yml` cible la CI et la production.

```bash
npm ci
cp .env.example .env      # les valeurs par défaut correspondent au bootstrap ci-dessous
npm run db:bootstrap      # crée les rôles PostgreSQL et la base (idempotent)
npm run db:migrate        # applique les migrations (schéma + RLS)
npm run db:seed           # « Les Jardins de Prilly » + un second tenant témoin
npm run verifier          # build + API + toute la suite de tests
npm run dev               # api :3001 · web :3000
```

Puis ouvrir [localhost:3000](http://localhost:3000). Trois comptes de démonstration, mot de passe
commun `Prometis!2026` :

| Compte | Ce qu'il montre |
|---|---|
| `christophe@cbpromotions.ch` | propriétaire : toutes les opérations, les droits d'accès, l'audit |
| `julie@cbpromotions.ch` | cheffe de projet : une seule opération, confiée explicitement |
| `m.girard@constructa.ch` | **deux sociétés** : propriétaire chez Constructa, externe scopé chez CB Promotions |

Vérification en ligne de commande :

```bash
curl -s http://localhost:3001/health
```

L'API refuse tout accès aux données métier sans jeton portant un espace de travail. Un compte
membre de deux sociétés obtient deux jetons distincts, et chacun ne donne accès qu'à sa société —
c'est ce que prouve `npm test`.

## Structure

```
prisma/            schema.prisma (source de vérité) · migrations/ · seed.ts
apps/api/          NestJS — contexte tenant, règles métier
apps/web/          Next.js (App Router) — les 14 écrans
tests/             isolation RLS, identité et accès, bilan, cohérence prototype
scripts/           bootstrap-db.sh
.claude/skills/    guide de développement pour Claude Code
```

## Isolation multi-tenant

L'isolation est **en base**, par Row-Level Security PostgreSQL — pas par des `where` applicatifs.

- Deux rôles : `prometis` (propriétaire, migrations et seed) et `prometis_app`
  (l'application, `NOBYPASSRLS`, aucun droit DDL).
- 38 tables sur 40 portent une policy `USING` + `WITH CHECK`. Les 2 exemptions (`comptes`,
  `webhook_events`) sont inscrites dans `app.rls_exemptions` avec leur raison, pour qu'un test
  d'inventaire distingue une exemption assumée d'un oubli.
- Le tenant est posé par transaction (`app.societe_id`). S'il manque, les policies renvoient
  **zéro ligne** : un oubli casse la fonctionnalité, il ne fuit jamais.

`npm test` échoue si une nouvelle table arrive sans policy.

## E-mails sortants

Toute communication sortante passe par `MailService.envoyer()` — un seul point de sortie, aucune
exception. Hors production, tout est réacheminé vers `MAIL_REDIRECT_TO` :

- objet préfixé du destinataire prévu : `[→ sophie.meylan@example.ch] Appel de fonds n° AF-2026-0001` ;
- bandeau en tête du corps avec destinataire, copies, copies cachées et objet original ;
- `cc` et `bcc` retirés — les conserver les enverrait vraiment.

Sans `MAIL_REDIRECT_TO`, l'envoi est **refusé** hors production : une erreur visible vaut mieux
qu'un appel de fonds expédié par erreur à un vrai acquéreur.

`MAIL_TRANSPORT=console` (défaut) journalise sans rien envoyer — on développe sans identifiants
SMTP. Passer à `smtp` et renseigner `SMTP_*` pour des envois réels.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/mail/configuration
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run db:bootstrap` | rôles PostgreSQL + base (idempotent) |
| `npm run db:migrate` | `prisma migrate dev` (rôle propriétaire) |
| `npm run db:migrate:deploy` | migrations en production |
| `npm run db:seed` | données de démonstration, 2 tenants |
| `npm run db:reset` | remise à zéro complète |
| `npm run verifier` | **build + API + tests** — la commande de reprise |
| `npm test` | la suite seule (l'API doit déjà tourner) |
| `npm run test:rls` | isolation seule |
| `npm run lint` · `npm run format` | qualité |
| `npm run typecheck` · `npm run build` | typage et build |
| `npm run dev` | api + web en parallèle |

## Documentation

- [CLAUDE.md](CLAUDE.md) — contexte métier et conventions (le *quoi*)
- `.claude/skills/prometis-dev/` — guide de développement (le *comment*)
- `Plan_Prometis.md` — spécification métier complète
- [BACKLOG.md](BACKLOG.md) — Lot 0 → Lot 8
- Notion — miroir de lecture pour le pilotage (le dépôt reste maître)
