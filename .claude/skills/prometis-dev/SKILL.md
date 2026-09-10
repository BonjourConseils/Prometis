---
name: prometis-dev
description: Guide opérationnel pour développer Prometis (SaaS multi-tenant de promotion immobilière suisse). À lire AVANT toute tâche de code sur ce dépôt — nouvelle table Prisma, migration, endpoint NestJS, écran Next.js, règle métier CFC / appel de fonds, passerelle Kolabimo, ou test d'isolation tenant. Déclencheurs : "Prometis", "CFC", "appel de fonds", "échéancier", "RLS", "societeId", "Kolabimo", "SIA 118", "adjudication", "Lot 0..8".
---

# Prometis — guide de développement

`CLAUDE.md` donne le **quoi** (métier, sources de vérité). Ce skill donne le **comment** :
conventions de code, mécanique RLS, commandes, et pièges vérifiés sur ce dépôt.

## 0. Où en est le projet — à lire en premier

**Lots 0 à 9 livrés** (15 août 2026) · **427 tests verts** · dépôt
https://github.com/BonjourConseils/Prometis

Le **fil rouge financier est complet** : `Budgété → Adjugé → Commandé → Facturé → Payé` se lit
poste CFC par poste CFC. Le moteur d'appels de fonds tourne, idempotent, avec référence QR suisse
et envoi e-mail redirigé. La **passerelle Kolabimo** est en place dans les deux sens : webhooks
entrants signés et dédoublonnés, boîte d'envoi sortante rejouable. Les modules annexes
(GED versionnée, séances & PV, courtage, trésorerie) closent le périmètre MVP.

Le **Lot 9** a branché les décisions d'hébergement : MFA TOTP, stockage S3 Infomaniak, SMTP
`noreply@prometis.ch`, QR-facture PDF jointe aux appels de fonds, OCR auto-hébergé.

**Prochain : les jalons de validation sur promotions réelles.** Le backlog de périmètre est
épuisé ; la V2 (portail acquéreur, signature QES, intégrations comptables et bancaires,
import CAN/NPK) ne s'engage qu'après le go/no-go du second jalon.

`references/roadmap.md` porte l'état détaillé lot par lot **et le tableau des sujets non livrés
avec leur cause** — OIDC, MFA, SMTP, extraction PDF, PDF de la QR-facture, notation multicritère,
circuit multi-approbateurs, identité des dossiers antérieurs à la connexion Kolabimo, PV en PDF. Aucun n'est un oubli : chacun
attend un arbitrage, et le code est écrit pour l'accueillir. Ne pas en « débloquer » un en
contournant le schéma.

Pour reprendre après une remise à zéro de la conversation :

```bash
npm ci && npm run db:bootstrap && npm run db:migrate && npm run db:seed && npm run verifier
```

Puis `npm run dev` et se connecter avec `christophe@cbpromotions.ch` / `Prometis!2026`.

## 1. Sources de vérité — ordre de préséance

1. `prisma/schema.prisma` — 40 tables, 30 enums. **Ne pas modifier le modèle** sans décision explicite.
2. `Plan_Prometis.md` — spéc métier (31 p.). §5.2 modules A→P, §7 architecture, §9 les 14 écrans.
3. `BACKLOG.md` — ordre de construction, Lot 0 → Lot 8.
4. Notion — miroir de la doc (voir `references/notion.md`). Le dépôt est maître, Notion suit.

Si un écran, un endpoint ou un test contredit le schéma → c'est l'écran/endpoint/test qui a tort.

## 2. Architecture du dépôt

```
Prometis/
├── prisma/            schema.prisma (racine unique) · migrations/ · seed.ts
├── apps/api/          NestJS — API REST, contexte tenant, règles métier
├── apps/web/          Next.js (App Router) — les 14 écrans
├── tests/             tests d'isolation RLS (vitest, tapent la vraie base)
├── scripts/           bootstrap-db.sh (rôles + base)
└── docker-compose.yml PostgreSQL + Redis (cible CI/prod)
```

**Package manager : `npm` workspaces** (pas pnpm). Raison : le client Prisma généré est hoisté
dans `node_modules/` racine et partagé sans ambiguïté par `apps/api` et `tests/`. Un changement
de gestionnaire casserait la résolution de `@prisma/client`.

## 3. Multi-tenant : la règle non négociable

Toute donnée métier appartient à une `Societe` (le tenant). L'isolation est **en base**, par
Row-Level Security PostgreSQL — pas seulement par des `where` applicatifs.

### Deux rôles PostgreSQL

| Rôle | Usage | RLS |
|---|---|---|
| `prometis` (owner) | migrations, seed — via `DIRECT_DATABASE_URL` | contournée (owner) |
| `prometis_app` | **l'application** — via `DATABASE_URL` | **appliquée** |

L'app ne doit **jamais** se connecter avec le rôle owner. Si un test d'isolation passe trop
facilement, vérifier d'abord quel rôle il utilise.

### Le contexte tenant

Les policies lisent `current_setting('app.societe_id')`. Ce réglage est **par connexion**, donc
toute requête tenant doit passer par une transaction qui le pose :

```ts
// apps/api/src/prisma/tenant-prisma.service.ts
await this.runInTenant(societeId, (tx) => tx.operation.findMany());
// → BEGIN; SET LOCAL app.societe_id = '<id>'; ... ; COMMIT;
```

Ne jamais utiliser `PrismaService` brut dans un service métier — uniquement `TenantPrismaService`.
Sans le réglage, `app.current_societe_id()` renvoie `NULL` et **toutes** les policies renvoient 0 ligne
(refus par défaut, jamais fuite). C'est voulu : un oubli casse la fonctionnalité, pas la sécurité.

### Ajouter une table : la checklist RLS

Seules 11 tables portent `societe_id` (+ `societes` elle-même). Les 26 autres sont rattachées
par un parent, et 2 sont exemptées. Pour toute
nouvelle table, ajouter une policy dans une migration dédiée :

- la table porte `societe_id` → `USING (societe_id = app.current_societe_id())`
- elle porte `operation_id` → `USING (app.is_tenant_operation(operation_id))`
- sinon → utiliser / créer un helper `app.is_tenant_<parent>(id)` (cf. `references/rls.md`)

Puis : `GRANT` pour `prometis_app`, et un cas dans `tests/rls-isolation.spec.ts`.
**Une table sans policy est une fuite cross-tenant.** Le test d'inventaire échoue si une table
publique n'a ni policy ni exemption documentée.

Exemptions assumées (documentées, pas oubliées) : `comptes` (identité globale, lue avant
d'avoir un tenant), `webhook_events` (journal d'ingestion), `_prisma_migrations`.

## 4. Commandes

```bash
npm run db:bootstrap   # crée les rôles + la base (idempotent)
npm run db:migrate     # prisma migrate dev  (rôle owner via DIRECT_DATABASE_URL)
npm run db:seed        # « Les Jardins de Prilly » + 2e tenant de contrôle
npm run verifier       # build + API + toute la suite : LA commande de vérification
npm test               # la suite seule — l'API doit déjà tourner, sinon elle échoue
npm run test:rls       # isolation seule
npm run dev            # api (:3001) + web (:3000)
```

Docker n'est pas installé sur la machine de dev : `docker-compose.yml` cible la CI et la prod,
le dev local tape le PostgreSQL Homebrew (`postgresql@16`) et Redis Homebrew déjà lancés.

`npm run db:reset` détruit la base. Prisma bloque cette commande quand elle est lancée par un
agent : c'est voulu, ne pas contourner le garde-fou — demander à l'humain.

**`npm run db:seed` est tout aussi destructeur** : il `TRUNCATE` les 43 tables avant de
réécrire la démonstration. La base de dev contient les promotions réelles saisies pendant les
tests. Ne jamais le lancer sans le demander.

**Pour CONSTATER l'état des données, se connecter avec `DIRECT_DATABASE_URL` (rôle owner),
jamais avec `DATABASE_URL`.** `DATABASE_URL` porte le rôle `prometis_app`, qui est
`NOBYPASSRLS` : hors transaction applicative, `app.societe_id` n'est pas posé et **toutes les
tables tenant répondent zéro ligne**. Le 3 septembre 2026, ces zéros ont été lus comme une base
vide ; le `db:seed` lancé pour « réparer » a détruit une promotion réelle qui était intacte.
La preuve qu'une réinitialisation a eu lieu, ou non, est ailleurs :
`select migration_name, finished_at from _prisma_migrations order by finished_at` — après un
reset, toutes les lignes portent le même horodatage.

## 4 bis. Pièges d'outillage rencontrés (ne pas les redécouvrir)

- **Prisma est fixé en `^6`.** Prisma 7 supprime `url` du bloc `datasource`, exige un
  `prisma.config.ts` et des driver adapters — le schéma fourni ne validerait plus. Kolabimo est
  en Prisma 5 ; rester sur la même sémantique de schéma. Ne pas lancer `npm update prisma`.
- **Pas d'`incremental: true` dans `tsconfig.base.json`.** Avec cette option, un
  `tsc --noEmit` (typecheck) écrit un `.tsbuildinfo` qui fait croire au `nest build` suivant
  qu'il n'y a rien à émettre : le build sort **vide et sans erreur**. Symptôme :
  `Cannot find module './app.module'` au démarrage.
- **Pas de `ValidationPipe` de Nest.** Elle dépend de class-validator ; la convention du projet
  est zod. Le premier lot avec un corps de requête ajoute un pipe zod, pas une seconde
  bibliothèque de validation.
- **`prisma migrate dev` a besoin de `CREATEDB`** sur le rôle propriétaire (shadow database).
  `bootstrap-db.sh` le donne. La production utilise `migrate deploy`, qui n'en a pas besoin.
- **L'en-tête `x-societe-id` n'existe plus.** C'était l'échafaudage du Lot 0, pour rendre
  l'isolation testable avant l'authentification ; le Lot 1 l'a remplacé par le jeton portant
  l'espace de travail. Toute doc ou tout script qui y fait encore référence est périmé.
- **`prisma migrate dev` peut rester bloqué** après avoir appliqué une migration écrite à la
  main (il attend une entrée sur un terminal non interactif). La migration *est* appliquée —
  vérifier `_prisma_migrations` avant de relancer. Pour des migrations SQL écrites à la main,
  préférer `npx prisma migrate deploy`, non interactif.
- **Prisma lie les entiers JavaScript en `bigint`** dans `$queryRaw`. Tout appel à une fonction
  PostgreSQL déclarée avec des paramètres `integer` exige un cast explicite :
  `app.membership_actif(${id}::int, ${autre}::int)`. Sans lui : « function … does not exist ».
- **`kill %1` ne fonctionne pas** dans les shells non interactifs de l'agent : le serveur
  précédent survit et c'est l'ancien binaire qui répond. Utiliser `pkill -f apps/api/dist/main.js`
  ou capturer le PID.

## 4 ter. Identité et autorisations (Lot 1)

Trois barrières distinctes, à ne pas confondre :

| Barrière | Où | Ce qu'elle protège |
|---|---|---|
| **RLS** | base | les *données* — aucune fuite entre tenants |
| **Rôle + modules** | guards NestJS | les *actions* dans la société |
| **`OperationAccess`** | guards + `AccessService` | les *opérations* confiées à ce membre |

### Le jeton en deux temps

1. `POST /auth/login` → jeton d'**identité** (`sub`, `email`). Il n'ouvre aucune donnée métier.
2. `POST /auth/workspace` `{ societeId }` → jeton portant `sid`/`mid`/`role`. C'est lui qui
   détermine `app.societe_id`.

Un compte peut appartenir à plusieurs sociétés : le sélecteur d'espace de travail n'est pas un
confort, c'est le modèle.

### Décorateurs

```ts
@Public()                     // ni compte ni espace — réservé à /health et /auth/login
@NoWorkspace()                // compte requis, espace non — le sélecteur uniquement
@Roles('OWNER', 'ADMIN')      // Membership.role
@RequireModule('APPELS_FONDS')            // Societe.modulesActifs
@RequireOperationAccess({ level: 'OPERATE', module: 'SOUMISSIONS' })
```

**L'espace de travail est requis par défaut.** Une route qui oublie de se déclarer devient plus
stricte, jamais plus permissive — c'est le sens dans lequel on veut se tromper.

Tout nouveau contrôleur doit être ajouté à `AppModule.configure()` : c'est là que le middleware
décode le jeton. L'oubli donne un 401, pas un accès.

### Audit

`AuditService.enregistrer(tx, …)` prend **obligatoirement** la transaction du changement. Si
l'écriture métier est annulée, la trace l'est aussi : une piste d'audit qui atteste d'une action
qui n'a pas eu lieu est pire que pas de piste. `AuditLog.utilisateurId` reçoit le **membershipId**,
pas le compteId — la table est scopée à une société.

### Le pré-tenant

`app.memberships_du_compte()` et `app.membership_actif()` sont `SECURITY DEFINER` : elles
répondent à « à quelles sociétés ce compte appartient-il ? » avant qu'un tenant existe, ce que la
RLS interdit par construction. Elles sont scopées à un compte, `search_path` figé, `EXECUTE`
révoqué de `PUBLIC`. Toute nouvelle fonction de ce type doit être inscrite dans
`app.security_definer_autorisees` avec sa raison.

### Comptes de démonstration

Mot de passe commun `Prometis!2026` :
`christophe@cbpromotions.ch` (OWNER CB Promotions) · `julie@cbpromotions.ch` (CHEF_PROJET, MANAGE sur l'opération) ·
`m.girard@constructa.ch` (OWNER chez Constructa **et** EXTERNE chez CB Promotions, scopé
SOUMISSIONS/CONTRATS/DOCUMENTS).

### Ce qui n'est pas fait, et pourquoi

- **OIDC** : le plan le prévoit, mais Docker est absent (pas de Keycloak local). L'auth par
  identifiants est derrière `PasswordService` + `TokenService` — c'est ce couple qui disparaît
  le jour de la bascule, pas le RBAC ni le contexte tenant.
- **MFA** : *impossible sans modifier le schéma*. Aucun champ ne stocke un secret TOTP ni des
  codes de secours. Ne pas l'improviser : c'est une décision de modèle de données.

## 4 quinquies. Écritures sur des enfants (Lot 2 et suivants)

La RLS garantit qu'une ligne appartient au bon **tenant**, pas à la bonne
**opération**. Sans contrôle explicite, un membre ayant accès à l'opération A pourrait modifier
un lot de l'opération B de la même société : le guard `@RequireOperationAccess` serait contourné.

**Règle** : toute route qui écrit sur un enfant est imbriquée sous
`/operations/:operationId/…`, et le service remonte la chaîne jusqu'à cet `operationId`
(`bienDeLOperation`, `lotDeLOperation`, `parkingDeLOperation` dans `FoncierService`). Une route
`/lots/:id` isolée n'aurait rien à quoi rattacher le contrôle.

Correspondance modules ↔ routes, à respecter pour toute nouvelle route :

| Domaine | `AppModule` (société) | `AccessModule` (accès par opération) |
|---|---|---|
| parcelles, biens, PPE, fiche opération | `FONCIER` | `FONCIER` |
| lots, parkings | `LOTS` | `VENTES` |
| bilan promoteur | `BILAN_PROMOTEUR` | `VENTES` |
| annuaire et équipe projet | `ACTEURS` | `ACTEURS` |

Le bilan promoteur vit dans `apps/api/src/operations/bilan.ts` — fonction **pure**, tout en
`Decimal`, testée sans base. C'est le chiffre que le promoteur confrontera à ses propres tableaux :
il ne se calcule pas dans un contrôleur.

**Tests qui écrivent** : ils doivent effacer ce qu'ils créent. Les autres suites supposent la base
dans l'état du seed ; un fichier qui laisse ses données derrière lui ne casse pas le sien, il casse
les suivants — et le diagnostic part dans la mauvaise direction. Voir l'`afterAll` de
`tests/foncier-acteurs.spec.ts`.

## 4 sexies. Budget CFC et fil rouge (Lot 3)

L'arbre CFC est la colonne vertébrale : c'est sur lui que se lit
`Budgété → Adjugé → Commandé → Facturé → Payé`. `apps/api/src/budget/cfc-arbre.ts` contient les
**fonctions pures** d'agrégation et de ventilation — elles ne se calculent pas dans un contrôleur.

- **Propre vs total** : chaque nœud expose ce qui lui est directement rattaché *et* le total
  descendants compris. Ne jamais n'exposer que l'un des deux : un promoteur doit pouvoir savoir
  si un montant vient du poste ou de ses sous-postes.
- **Tout est hors taxe**, comme `LigneBudget.montant`. La TVA est portée à part (`tvaPct`).
  Comparer un budget HT à une `Facture.montantTTC` afficherait un dépassement de 8,1 % fictif —
  utiliser `montantHT`.
- **« Initial »** = la première version de budget créée (le schéma ne porte pas de drapeau) ;
  **« révisé »** = la version courante ou celle demandée.
- **Une seule `BudgetVersion.isCourant`** par opération : invariant tenu par `BudgetService`, pas
  par le schéma. Deux budgets courants et le bilan promoteur compte deux fois les mêmes postes.
- **Arrondis de ventilation** : le résidu est absorbé par le dernier lot pour que la somme
  retombe exactement sur le montant ventilé. Reproduire ce motif pour toute répartition
  (millièmes PPE, appels de fonds).
- **Suppression d'un poste CFC** refusée s'il porte quoi que ce soit, en nommant ce qui bloque.
- **La trame importable n'est pas le catalogue CRB**, qui est sous licence. C'est la structure
  publique des groupes et sous-groupes, à adapter par opération.

## 4 septies. Soumissions, adjudications, contrats (Lot 4)

La chaîne : `Soumission` (sur un `CfcNode`) → `Offre` → `Adjudication` → `Contrat` → `Avenant`.
Elle alimente les colonnes **adjugé** et **commandé** du budget CFC.

- **Toujours comparer au net après remise.** `montant × (100 − remisePct) / 100`. Une offre plus
  chère au brut peut être moins-disante au net — classer au brut ferait signer avec le mauvais
  soumissionnaire. C'est aussi le net qui devient `montantAdjuge`, puis `Contrat.montant`.
- **Le contrat reprend tout de l'adjudication** : montant, entreprise, poste CFC. Rien n'est
  ressaisi, sinon le lien adjugé → commandé se rompt.
- **Adjuger est une action sensible** (DoD) : auditée, et elle bascule tous les statuts dans la
  même transaction — soumission `ADJUGEE`, offre `RETENUE`, autres `ECARTEE`.
- **Avenant = montant signé.** Un travail en moins est négatif et diminue le commandé.
- **Réception → fin de garantie** calculée à +2 ans (SIA 118), pas saisie.
- Une offre `ECARTEE` ou sans prix reste affichée avec son motif, mais sort du classement.

**Notation multicritère : non implémentée, et c'est un choix.** `Offre` n'a aucun champ de score.
La note exposée est une *note de prix*, nommée comme telle dans l'API et à l'écran. Ajouter
références et délais suppose d'étendre `schema.prisma` — décision produit, pas contournement.

## 4 octies. Factures et écarts (Lot 5)

- **`cfcSuggereId` n'est jamais `cfcNodeId`.** La lecture automatique *propose* ; seule la
  validation humaine impute. Une facture n'entre dans la colonne « facturé » que validée.
- **Le contrôle `facturé cumulé ≤ commandé` est bloquant** et chiffre le dépassement. Il peut
  être forcé (un avenant arrive parfois après la facture) — le forçage part dans `AuditLog`.
- **Tout est hors taxe, y compris le payé.** Les règlements sont encaissés en TTC : on les ramène
  à leur part HT avant de les afficher à côté du facturé. Sans ça, une facture soldée montrerait
  8,1 % de « payé » en trop.
- **Le rapprochement doit toujours donner un motif lisible.** Un comptable qui ne comprend pas la
  proposition la revérifiera à la main, ce qui annule le gain. Et sans indice suffisant, on ne
  propose **rien** plutôt que n'importe quoi.
- **L'OCR n'est pas implémenté et c'est délibéré.** `extraction.ts` part d'un texte déjà extrait ;
  le passage PDF → texte attend le choix d'un service compatible nLPD. Ne pas « brancher » un
  fournisseur sans arbitrage.
- **Circuit de validation** : assuré par les rôles + statuts, tracé transition par transition dans
  `AuditLog`. `Facture.validePar` ne porte qu'un validateur — un registre de plusieurs
  approbateurs exigerait d'étendre le schéma.

## 4 nonies. Ventes et appels de fonds (Lot 6)

Le moteur vit dans `AppelsDeFondsService.declencherEtape()`. Trois propriétés à ne jamais casser :

1. **Idempotence.** Unicité `(reservationId, etapeId)` en base, et référence QR **déterministe**
   construite depuis cette même clé. Rejouer un déclenchement ne crée rien — indispensable quand
   le Lot 7 rejouera des webhooks Kolabimo.
2. **Un jalon sans `pourcentage` n'appelle rien** — c'est un suivi de chantier.
3. **Les e-mails partent APRÈS le commit.** Envoyer dans la transaction expédierait des appels
   pour des lignes qu'un échec annulerait. Un échec d'envoi, lui, n'annule pas l'appel.

- **`OPTION` n'est pas un engagement** : seuls `RESERVE`, `FONDS_VERSES`, `VENDU` reçoivent un
  appel (`STATUTS_ENGAGES` dans `calculs.ts`).
- **Référence QR** : 27 chiffres, clé de contrôle par modulo 10 récursif (`qr-reference.ts`).
  Ne pas « simplifier » l'algorithme — la banque le vérifie.
- **`Reservation.prixTotalActe` est figé** à la signature ou dès qu'un appel est parti. Le prix
  du lot peut bouger après ; l'acte, non.
- **`EcheancierEtape.pourcentage` se fige** dès qu'un appel en découle.
- L'échéancier **chiffre son écart** à 100 % — un « incomplet » sans montant ne se corrige pas.

**PDF de la QR-facture : non généré.** Il suppose de choisir le stockage de documents. L'e-mail
porte la mention en clair ; ne pas la retirer avant que la pièce existe vraiment.

## 4 decies. Passerelle Kolabimo (Lot 7)

Tout vit dans `apps/api/src/passerelle/`. Détail fonctionnel dans
`references/kolabimo-gateway.md` ; ci-dessous ce qu'il ne faut pas défaire.

**Authentifier un appel machine.** Un webhook n'a pas de jeton — aucun humain ne l'émet. La route
`POST /webhooks/kolabimo` est donc `@Public()`, et authentifiée autrement :

1. l'en-tête `x-api-key` identifie le **tenant** via `app.societe_de_cle_api()`, une fonction
   `SECURITY DEFINER` posée par la migration du Lot 7 — même motif qu'au Lot 1 pour le sélecteur
   d'espace : `api_keys` est sous RLS, et le tenant est justement ce qu'on cherche ;
2. l'en-tête `x-kolabimo-signature` (`t=…,v1=…`) porte un HMAC-SHA256 du **corps brut**, avec la
   même clé comme secret. D'où `rawBody: true` dans `main.ts` : re-sérialiser l'objet donnerait
   une autre empreinte et rejetterait toute signature valide.

L'horodatage est **dans** le message signé, pas seulement à côté — sinon on rejouerait une
signature valide en rafraîchissant la date. Fenêtre : 5 minutes.

**Ordre des étapes, dans `recevoir()`** — il n'est pas cosmétique :
authentifier → journaliser → traiter → conclure. Journaliser avant d'authentifier laisserait
n'importe qui remplir le journal ; c'est **l'insertion** de la `dedupeKey` unique qui dédoublonne,
pas une lecture préalable.

**Un événement en erreur ne se retraite pas tout seul.** Il reste en `ERREUR` avec sa raison,
rejouable à la main depuis l'écran Passerelle. Rejouer une erreur qu'on n'a pas comprise ne fait
que la répéter.

**`webhook_events` est la seule table métier sans protection RLS** — elle n'a pas de `societe_id`,
et c'est voulu : un événement est journalisé avant qu'on sache toujours à qui il appartient. La
société traitée est écrite dans la charge, et le filtre du journal est **applicatif**
(`payload.societeId`). C'est `tests/passerelle-webhooks.spec.ts` qui tient cette étanchéité, pas
PostgreSQL — ne pas supprimer ce test.

**Ce que Kolabimo n'a PAS le droit de changer** (`reconciliation.ts`, pur et testé) :
- le **prix total acte** dès que l'acte est signé ou qu'un appel de fonds en découle — le laisser
  bouger changerait rétroactivement l'assiette d'une créance déjà envoyée ;
- une **annulation** quand des appels sont partis : l'événement passe en `ERREUR` avec un message
  explicite, parce qu'une créance s'annule par un avoir ou un remboursement, donc par un humain ;
- un **statut inconnu** lève au lieu de retomber sur `OPTION` — une vente sortirait sinon de
  l'assiette des appels sans que personne ne le voie.

**Sortant : motif de la boîte d'envoi.** `deposerSortant()` écrit l'événement **dans la
transaction métier** (donc il ne peut pas exister sans le changement qui le produit), et
`livrer()` tente la livraison **après le commit**. Kolabimo indisponible n'empêche jamais de clore
un jalon : l'événement reste en attente et se rejoue. La `dedupeKey` sortante dérive de
`(opération, étape)` ou de l'id d'encaissement — rejouer le geste métier ne produit pas un second
message.

**La clé Kolabimo est une donnée du tenant** (10 septembre 2026). Depuis SEC1 (Kolabimo 1.3.0),
une clé est cloisonnée à UN promoteur : chaque société la saisit dans l'écran Passerelle, table
`connexions_kolabimo`. `KolabimoClient` ne connaît aucune clé — chaque appel reçoit l'`AccesKolabimo`
de la société. Ne jamais réintroduire de clé d'instance : la société B lirait les promotions de A.

- **Deux secrets, deux sens.** La clé d'API (générée dans Kolabimo, saisie ici) sert à LIRE. Le
  secret de webhook (généré ici, montré une fois, collé dans Kolabimo) sert à SIGNER. Les deux
  sont chiffrés AES-256-GCM, clé hors base `INTEGRATIONS_ENCRYPTION_KEY` ; sans elle, refus.
- **Kolabimo n'envoie pas de clé d'API avec ses webhooks.** La société se lit dans l'URL
  (`/webhooks/kolabimo/:jeton`, résolue par `app.societe_de_jeton_kolabimo`, SECURITY DEFINER).
  L'ancienne route `/webhooks/kolabimo` + `x-api-key` ne sert plus qu'au contrat interne.
- **Une clé est essayée avant d'être stockée** (`GET /api/v1/me`) et doit être de type
  `PROMOTEUR` — une clé d'agence a un autre périmètre.
- **Rattacher ne déclenche jamais d'appel de fonds.** Une étape close chez Kolabimo arrive close ;
  un lot vendu en cours de chantier passe par le rattrapage.
- **Le contrat se relève dans le code de Kolabimo** (`~/Documents/Projets/ImmoCollab`,
  `src/routes/api/v1/`, `src/services/passerelle.service.js`), pas dans sa documentation Notion,
  qui décrivait encore l'API de juillet. `kolabimo-api.ts` porte les schémas zod correspondants.
- Les tests jouent contre un **faux Kolabimo local** (`tests/kolabimo-connexion.spec.ts`) qui rend
  exactement ces formes.

## 4 undecies. Modules annexes (Lot 8)

**Stockage : un seul point de sortie, comme les e-mails.** `StockageService` est le seul à
toucher un support physique. Deux transports : `local` (défaut, écrit sous
`STOCKAGE_LOCAL_DIR`, **refusé en production** — le disque d'un conteneur n'est pas durable)
et `s3`, déclaré mais qui lève, parce que choisir l'hébergeur engage la localisation des
données au sens de la nLPD. En changer ne doit toucher qu'un fichier.

**Le nom d'un fichier vient d'un utilisateur.** `chemin.ts` est pur et testé : le nom
d'origine reste en base pour l'affichage (`Document.fileName`), la **clé d'objet** est
assainie, préfixée par la société et suffixée d'un UUID. `cleObjetSure()` revérifie ce qui
vient de la base, et le service compare en plus le chemin **résolu** à la racine — c'est la
seule vérification qui tienne quoi qu'on ait pu écrire auparavant.

**GED : une version n'écrase jamais la précédente.** Nouvelle ligne, `parentDocumentId`
pointant sur la **racine** (jamais sur un maillon, sinon les versions forment un arbre),
ancien `isCourant` retombé à faux. Un plan remplacé reste la pièce sur laquelle une
entreprise a chiffré son offre. D'où aussi le refus de supprimer un maillon isolé.

**Rattachements : la RLS ne suffit pas.** Un document se rattache à l'un de onze parents ;
chacun est vérifié comme appartenant à l'opération de la route (`verifierRattachements`).
Sans ce contrôle, une pièce atterrirait dans le dossier d'une autre promotion de la même
société. `Acteur` fait exception : il est au niveau de la société, et c'est voulu.

**Téléchargement en `attachment`, jamais `inline`** : un SVG ou un HTML déposé par un tiers
exécuterait son script dans l'origine de l'application.

**PV : le service ne réécrit pas la GED.** `genererPv()` passe par `GedService`, donc mêmes
droits, même versionnage, même audit. Rejouer produit une **version**, jamais un second
document — un PV corrigé remplace le précédent, qui reste consultable parce qu'il a peut-être
déjà été diffusé.

**Courtage — deux pièges chiffrés** (`commission.ts`, pur) :
- l'**assiette** : les prix de vente sont tenus hors taxe dans tout le produit ; un mandat
  « sur le prix TTC » porte sur une assiette à reconstituer (× 1,081), pas sur le chiffre
  stocké. Sur 850 000 à 3 %, l'oubli coûte 2 065.50 CHF au courtier ;
- le **forfait ignore l'assiette** — 15 000 restent 15 000 quel que soit le prix du lot.

Autres règles : une liste de lots vide ne couvre **rien** (pas « tout ») ; deux exclusivités
sur un même lot sont refusées à la signature — c'est une commission payée deux fois ; une
commission ne naît que sur une réservation **engagée**, et pas deux fois pour le même couple
(mandat, réservation) — l'unicité n'est pas au schéma, elle est tenue par le service et par
un test.

**Trésorerie — la seule vue qui mélange HT et TTC, et c'est correct.** Elle additionne des
**mouvements de caisse** (`Encaissement`, `PaiementFournisseur`), et un virement bancaire ne
connaît pas la TVA. Elle ne se compare donc PAS à l'écran Écarts : elle répond à « ai-je de
quoi payer la prochaine situation ? », lui à « suis-je dans mon budget ? ». Les engagements
fournisseurs sont rendus à part, hors taxe, explicitement non additionnables aux flux.
Les mois sans mouvement sont **comblés** : sauter de mars à juillet masquerait le creux.

## 4 duodecies. Mise en production (Lot 9)

**Second facteur — `totp.ts`, `chiffrement.ts`, `mfa.service.ts`.**
TOTP est **écrit, pas importé** : cinquante lignes figées depuis 2011, et la RFC 6238 publie
ses vecteurs de test — on vérifie donc les chiffres exacts, pas un comportement plausible.
Ne pas remplacer par une bibliothèque sans raison : c'est une dépendance de moins sur le
chemin de l'authentification.

- Le secret est **chiffré** (AES-256-GCM), jamais haché : le vérifier suppose de le relire.
  La clé vit dans `MFA_ENCRYPTION_KEY`, hors base. **Sans clé, l'enrôlement est refusé** —
  un secret TOTP en clair vaut l'absence de second facteur.
- `totpActiveAt` nul = enrôlement **non confirmé** : la connexion reste à un facteur. Ne pas
  « simplifier » en activant au moment de la génération : un QR affiché puis abandonné
  enfermerait le compte dehors.
- Entre le mot de passe et le code, la connexion rend un **jeton de défi** (`typ: 'defi'`).
  `TokenService.verify()` le refuse partout ailleurs — c'est le point qui empêche de
  contourner le second facteur. `lastLoginAt` n'est touché qu'après le code.
- Les codes de secours sont hachés en SHA-256 **et non argon2** : générés par la machine
  avec ~50 bits d'entropie, un hachage lent ne protégerait de rien et coûterait, à chaque
  connexion de secours, autant de vérifications qu'il reste de codes. L'usage unique vient
  du retrait de la liste.
- Désactiver exige un **code**, pas seulement la session : une session volée ne doit pas
  pouvoir retirer la protection qu'elle vient de contourner.
- Le QR est fabriqué **dans le navigateur**. Le produire côté serveur ferait transiter le
  secret dans une URL, donc dans les journaux de tous les intermédiaires.

**Stockage S3** — transport `s3` (Infomaniak) avec `forcePathStyle`, indispensable hors AWS.
Même convention de clé que `local` : basculer ne touche ni les fiches ni le reste de la GED.

**QR-facture — `qr-facture.ts` (pur) puis `qr-facture.pdf.ts`.**
La règle à ne jamais perdre : **une référence QR à 27 chiffres n'est valable qu'avec un
QR-IBAN** (identifiant d'institution 30000–31999). Sur un IBAN ordinaire, la banque refuse le
document — et l'acquéreur croit avoir payé. Le module décide **avant** de générer : QR-IBAN →
référence structurée ; sinon → pas de référence, numéro d'appel en message, et la raison dite
sur la facture et dans les journaux. La facture est archivée en GED en même temps qu'envoyée,
et rien de tout ça ne peut faire échouer l'appel de fonds.

**OCR auto-hébergé — `ocr.service.ts`.** C'est le seul endroit où des données de tiers
auraient pu partir chez un prestataire ; elles ne partent pas. Le binaire est appelé par
`execFile`, **jamais via un shell**, et le PDF transite par un répertoire temporaire effacé
quoi qu'il arrive. `pdftotext` par défaut ; `ocrmypdf` ou `tesseract` pour des scans.

## 4 terdecies. Saisie depuis l'interface web

Les écrans ont longtemps été en lecture seule ; ils saisissent désormais le fil rouge —
promotion, foncier, budget CFC, soumissions. Quatre pièces, toujours les mêmes :

**Le relais générique — `apps/web/app/api/prometis/[...chemin]/route.ts`.** Un seul point de
passage du navigateur vers l'API, qui rattache le jeton stocké en cookie `httpOnly`. Il ne
valide **rien** : la validation appartient à l'API, la dupliquer côté web ferait diverger deux
sources de vérité. La protection CSRF repose sur `SameSite=lax`.

**Le client — `apps/web/lib/api-client.ts`.** `appelApi<T>()` rend `{ ok, erreur }` plutôt que
de lever. `champ()` traduit une chaîne vide en `undefined` : zod doit voir une **absence**, pas
un vide — sinon un champ facultatif laissé blanc devient une erreur de validation.

**Le dépôt de fichier — `televerser()`.** Le PDF d'une facture part en `multipart/form-data`.
Deux règles, toutes deux vérifiées par l'échec inverse :

- côté client, ne **jamais** poser `Content-Type` à la main : le navigateur doit le calculer
  pour y placer la frontière du multipart ;
- côté relais, retransmettre l'en-tête entrant **et les octets tels quels**
  (`request.arrayBuffer()`). Le relais forçait `application/json` et relisait le corps en
  texte : le fichier arrivait illisible.

Les **métadonnées** voyagent dans le même multipart (troisième paramètre de `televerser`) : un
document GED se dépose avec son titre et sa catégorie, jamais « d'abord le fichier, on classera
après ». Elles arrivent en texte côté API — d'où les `z.coerce` du `depotSchema`.

Ça se teste sans navigateur — le harnais ne sait pas remplir un `<input type="file">` : ouvrir
une session sur `/api/session`, choisir l'espace sur `/api/session/workspace`, puis poster un
`FormData` sur `/api/prometis/…`. C'est le vrai chemin, cookie compris.

**Couverture de la saisie (15 août 2026).** Tout le fil rouge et les modules annexes se pilotent
depuis l'interface : promotion, foncier, budget CFC, soumissions, factures, ventes, appels de
fonds, GED, séances & PV, courtage. Seule la **trésorerie** reste en lecture — elle agrège des
mouvements nés ailleurs, il n'y a rien à y saisir.

## 4 quaterdecies. Page publique

`apps/web/app/accueil/landing.tsx` + son **module CSS**. La racine `/` sert la landing au
visiteur sans session et la liste des promotions au connecté ; un jeton périmé continue de
partir sur `/login`, parce qu'à ce moment-là on n'accueille plus, on reconnecte.

Le module CSS est délibéré : la landing emprunte les **tokens** de `globals.css` (elle doit
ressembler au produit) mais aucune de ses règles. Un back-office et une page de vente n'ont pas
le même rythme, et mélanger leurs feuilles fait dériver les deux.

Deux pièges payés comptant :

- **`backdrop-filter` sur une barre collante** fait recomposer toute la page à chaque
  défilement. Retiré : sur fond clair, personne ne voit la différence.
- **Un fond sombre porté par la seule enveloppe** d'une section qui contient un enfant `sticky` :
  le navigateur promeut la bande dans une couche à part et **les textes les plus clairs
  disparaissent**. Les styles calculés restent corrects — seul l'affichage ment, ce qui rend le
  diagnostic pénible. Reposer le fond sur l'élément qui contient réellement le texte lève le
  problème.

**Le contenu ne promet que ce qui est livré.** Les maquettes annonçaient des relances
automatiques à J+10, un import camt.054, des exports ISO 20022 et un catalogue CRB importable :
rien de tout cela n'existe. Le texte a été ramené au produit réel. À rétablir au fur et à
mesure des livraisons, jamais avant.

**Le formulaire — `apps/web/app/components/formulaire.tsx`.** `Repliable` (bouton → formulaire
déplié) et `useEnvoi()` (envoi, erreur, `router.refresh()`). Le hook rend `false` en cas
d'échec, ce qui laisse le formulaire ouvert **avec la saisie de l'utilisateur** : elle n'est
jamais jetée au premier refus de l'API. Ce module existe parce que la troisième copie du même
code aurait été celle de trop.

**Les montants restent des chaînes** jusqu'au `Decimal` côté serveur. Les convertir en `number`
dans le navigateur ferait passer les prix par un flottant.

**La frontière serveur/client.** Un module `'use client'` n'exporte que des composants
utilisables depuis le serveur : une **fonction** qu'il exporte ne peut pas être appelée dans un
composant serveur (erreur d'exécution, pas de compilation — TypeScript ne voit rien). Les aides
partagées entre les deux mondes vont dans `apps/web/lib/format.ts`, qui n'est ni l'un ni l'autre.
C'est ce qui est arrivé à `nomAcquereur()`.

Deux pièges vérifiés :

- **Pas d'indentation par espaces dans les listes déroulantes CFC.** Elle casse la recherche au
  clavier, qui compare depuis le premier caractère — et l'ancienne version utilisait des espaces
  **insécables**, ce qui la cassait définitivement. Sur soixante-neuf postes, taper « 211 » est
  le geste utile ; la hiérarchie se lit déjà dans le code, c'est à cela que sert la numérotation.
- **Un test qui compte des lignes à l'échelle de la société casse dès qu'on saisit depuis
  l'interface.** C'est arrivé **sept fois** (`identite-acces`, `rls-isolation` ×3,
  `references-prototype` ×3). Portez l'assertion sur la promotion du seed
  (`where: { operation: { nom: 'Les Jardins de Prilly' } }`), ou sur l'invariant réel : « une
  version courante **par opération** », « Σ des pourcentages = 100 % **par échéancier** ». Une
  suite qui punit l'usage normal du produit finit par être désactivée. Avant d'écrire un
  `.toBe(n)` sur un `count()`, demandez-vous ce que devient ce chiffre quand un utilisateur crée
  une deuxième promotion — parce qu'il en créera une.

## 4 quater. E-mails : un seul point de sortie

**Toute** communication sortante passe par `MailService.envoyer()` — appel de fonds, relance,
invitation, partage de document. Rien d'autre ne parle à un transport SMTP. Ce n'est pas une
préférence de style : c'est la seule façon de garantir qu'aucun message ne parte chez un vrai
acquéreur pendant le développement.

```ts
await this.mail.envoyer({
  to: acquereur.email,
  subject: `Appel de fonds n° ${appel.numero}`,
  html: corps,
});
```

Hors production, `MailService` réachemine tout vers `MAIL_REDIRECT_TO` :

- l'objet devient `[→ destinataire.prévu@example.ch] Objet original` ;
- un bandeau en tête du corps rappelle destinataire, copies, copies cachées et objet original ;
- `cc` et `bcc` sont **supprimés** — les garder les enverrait vraiment.

**Si `MAIL_REDIRECT_TO` est absente hors production, l'envoi est refusé.** Une erreur visible vaut
mieux qu'un appel de fonds expédié par erreur à un vrai client.

`MAIL_TRANSPORT=console` (défaut) journalise sans rien envoyer : on développe sans identifiants
SMTP. Passer à `smtp` et renseigner `SMTP_*` pour des envois réels.

La transformation vit dans `apps/api/src/mail/redirection.ts` — fonction **pure**, sans NestJS ni
transport, testée dans `tests/mail-redirection.spec.ts`. Toute évolution du format se fait là.

Vérifier le routage : `GET /mail/configuration` et `POST /mail/test` (OWNER/ADMIN, indisponible
en production).

## 5. Conventions de code

- **Prisma** : `@map` en snake_case, `@@map` au pluriel (aligné Kolabimo). Montants
  `Decimal(12,2)` CHF, TVA par défaut `8.10`.
- **Decimal, jamais `number`** pour l'argent. Utiliser `Prisma.Decimal` et comparer avec
  `.equals()`. Un `parseFloat` sur un prix de lot est un bug (arrondis sur 850 000.00).
- **Validation** : zod aux frontières HTTP, DTO typés, erreurs typées (pas de `throw new Error`).
- **Permissions** : `Membership.role` (tenant) **puis** `OperationAccess` (opération + `AccessModule`).
  Les deux, pas l'un ou l'autre.
- **Audit** : `AuditLog` obligatoire sur adjudication, validation de facture, émission d'appel de
  fonds, changement de budget, passage d'un jalon à `COMPLETED`.
- **Modules** : vérifier `Societe.modulesActifs` avant d'exposer une route de commercialisation.
  Une EG ne doit pas voir `APPELS_FONDS`, même en lecture.

## 6. Règles métier à ne jamais recalculer « à la main »

Ces quatre règles sont la valeur du produit. Elles vivent dans des fonctions pures testées
unitairement, pas inlinées dans un contrôleur.

1. **Prix total acte** = `Lot.prixVente` + Σ `Parking.prix`. C'est l'assiette des appels de fonds,
   et il est **figé** dans `Reservation.prixTotalActe` à la vente (ne pas recalculer depuis le lot
   après signature : le prix du lot peut bouger, l'acte non).
2. **Appel de fonds** = `EcheancierEtape.pourcentage` × `Reservation.prixTotalActe`.
   Contrôle de cohérence : Σ des `pourcentage` non nuls d'une opération = 100 %.
   `pourcentage = NULL` → jalon de suivi chantier, **aucun** appel de fonds généré.
3. **Fil rouge CFC** : Budgété → Adjugé → Commandé → Facturé → Payé, agrégé sur l'arbre
   `CfcNode.parentId`. « Commandé » = contrat + Σ avenants. Contrôle : `facturé cumulé ≤ commandé`.
4. **Idempotence** : `(reservationId, etapeId)` unique sur `AppelDeFonds` ; `dedupeKey` sur
   `WebhookEvent` ; `externalId` sur `Reservation`. Rejouer un webhook ou re-déclencher un jalon
   ne doit **rien** créer en double.

Cas de référence à garder vert (issu du prototype) : lot A02 = 850 000 → 5 % = 42 500, 15 % = 127 500.

## 7. Definition of Done (rappel, par lot)

- migration + policies RLS + test d'isolation dédié ;
- DTO validés, erreurs typées, permissions `Membership` + `OperationAccess` ;
- tests unitaires sur les règles métier touchées ;
- `AuditLog` alimenté ; aucun secret en clair.

## Références

- `references/rls.md` — chemin tenant des 40 tables, helpers SQL, recette d'ajout de policy
- `references/data-model.md` — les 13 domaines du schéma et leurs invariants
- `references/roadmap.md` — Lot 0 → 8, phases, MVP/V2/V3, état d'avancement
- `references/kolabimo-gateway.md` — API v1, webhooks HMAC, table de mapping
- `references/notion.md` — pages Notion miroir et règle de synchronisation
