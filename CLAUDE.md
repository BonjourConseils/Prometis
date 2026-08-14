# Prometis — SaaS de gestion de promotions immobilières (Suisse romande)

> Contexte projet pour Claude Code. Lire ce fichier **en entier** avant de coder.
> Sources de vérité : `prisma/schema.prisma` (modèle de données validé),
> `Plan_Prometis.md` (spécification métier complète), `BACKLOG.md` (ordre de construction).

## 1. En une phrase

Un SaaS **multi-tenant** qui pilote une promotion immobilière de bout en bout : du foncier
au budget **CFC**, aux soumissions/adjudications (SIA 118), aux factures (lues par OCR/IA et
classées par CFC), jusqu'aux **appels de fonds** envoyés aux acquéreurs — avec une **passerelle**
vers l'app existante **Kolabimo** (source des lots, réservations et clients).

Le différenciateur : le **fil rouge financier** `Budgété → Adjugé → Commandé → Facturé → Payé`,
comparé en permanence poste CFC par poste CFC.

## 2. Public cible et profils

Le tenant est une **organisation** (`Societe.profil`) : `PROMOTEUR`, `ENTREPRISE_GENERALE`,
`ARCHITECTE`, `BUREAU_TECHNIQUE`, `REGIE`. L'app est **modulaire** (`Societe.modulesActifs`) :

- **Gestion de chantier** (autonome, tous profils) : Budget CFC, soumissions, adjudications,
  contrats, factures OCR, suivi des étapes, écarts, séances/PV, GED.
- **Commercialisation & appels de fonds** (surcouche promoteur) : lots, acquéreurs, bilan
  promoteur, échéancier de paiement, appels de fonds, trésorerie, courtage.

Une EG ou un architecte se connecte **en tant que tel** et ne voit que la gestion de chantier —
aucune « simulation » de promoteur.

## 3. Stack (proposée — à confirmer avant Lot 0)

- **Frontend** : React + Next.js + TypeScript.
- **Backend** : Node.js + NestJS (TypeScript), API REST + GraphQL pour les vues consolidées.
- **Base de données** : PostgreSQL + **Prisma**. `schema.prisma` est fourni et **validé**.
- **Isolation multi-tenant** : base partagée + **Row-Level Security (RLS)** PostgreSQL,
  policy sur `societe_id = current_setting('app.societe_id')`. Chaque requête pose le contexte tenant.
- **Auth** : OIDC/OAuth2 (Keycloak ou fournisseur suisse), MFA. Identité = `Compte`, appartenance =
  `Membership` (un compte peut appartenir à plusieurs sociétés → sélecteur d'espace de travail).
- **Stockage documents** : object storage S3 hébergé en Suisse (Exoscale / Infomaniak), chiffré.
- **Jobs asynchrones** : file (BullMQ) pour appels de fonds, exports, relances, webhooks.
- **Hébergement** : Suisse (nLPD), conteneurs Docker, IaC.

## 4. Conventions

- **Aligné sur Kolabimo** (l'autre SaaS) pour faciliter la passerelle : Prisma, PostgreSQL,
  `@map` en snake_case, `@@map` au pluriel. Respecter ces conventions dans tout nouveau modèle.
- Montants : `Decimal(12,2)` en **CHF**. TVA par défaut **8.1 %**. Pourcentages en `Decimal`.
- Tout modèle métier porte `societeId` (multi-tenant). Ne jamais exposer de données cross-tenant.
- **Piste d'audit** (`AuditLog`) sur les actions sensibles : adjudication, validation de facture,
  émission d'appel de fonds, changement de budget.

## 5. Règles métier à ne pas rater

- **Prix total acte d'un lot** = `Lot.prixVente` + Σ `Parking.prix` (box / intérieure / couverte /
  extérieure). C'est l'assiette des appels de fonds.
- **Échéancier** (`EcheancierEtape`) : jalons en % dont la somme fait **100 %**. La 1ʳᵉ étape =
  « signature de l'acte » (déclenchée lot par lot) ; les suivantes = jalons de chantier (tous les
  lots engagés). `pourcentage` est **optionnel** : un jalon sans % est un simple suivi de chantier.
- **Déclencheur des appels de fonds** : côté **Prometis** (maître de l'échéancier). Quand un jalon
  passe à `COMPLETED` (avec `dateCompletion`) → pour chaque réservation engagée,
  `montant = pourcentage × prix total acte` → génération PDF + QR-facture → envoi e-mail →
  suivi encaissement (camt.054) → push du statut vers Kolabimo.
- **Idempotence** : unicité `(reservationId, etapeId)` sur `AppelDeFonds` ; `dedupeKey` sur
  `WebhookEvent` ; `externalId` sur `Reservation` (réconciliation avec Kolabimo).
- **CFC** : arbre à N niveaux (`CfcNode.parentId`). Un poste agrège budgété / adjugé / facturé.
  Une ligne de budget peut être ventilée sur plusieurs lots (quote-part PPE / surface / égalité).
- **Factures** : OCR/IA extrait fournisseur, n°, dates, HT/TVA/TTC, réf. QR ; **propose** un CFC
  (`cfcSuggereId`) rapproché du contrat ; contrôle `facturé cumulé ≤ commandé` ; **validation humaine**
  obligatoire (circuit chef de projet → direction → comptabilité).

## 6. Passerelle Kolabimo (voir §6.5 du plan)

- Kolabimo expose une **API v1** (clé `x-api-key` par société) : promotions, lots (avec parkings +
  prix total acte), lots réservés + client, réservations (création idempotente via `externalId`).
- À **ajouter côté Kolabimo** : `GET /api/v1/promotions/:id/echeancier` et un webhook sortant.
- Webhooks : Kolabimo → Prometis (`reservation.*`) ; Prometis → Kolabimo (`echeancier.etape_completed`,
  statut des encaissements). Signés HMAC-SHA256, idempotents.
- Mapping : `kolabimoPromotionId` (Operation), `kolabimoAppartementId` (Lot),
  `kolabimoParkingId` (Parking), `externalId` / `kolabimoReservationId` (Reservation),
  `kolabimoEtapeId` (EcheancierEtape).

## 7. Ordre de construction

Suivre `BACKLOG.md`. En résumé : socle multi-tenant (Compte/Membership + RLS) → fil rouge financier
(Budget CFC → soumissions → adjudication → factures → écarts) → ventes & appels de fonds → passerelle
→ modules annexes (GED, séances, courtage, droits d'accès, trésorerie). Portail acquéreur = V2.

## 8. Vérité de référence (ne pas diverger)

- Modèle de données : `prisma/schema.prisma` (40 tables, 30 enums, validé `prisma validate`).
- Spéc métier & écrans : `Plan_Prometis.md` (31 pages ; §9 = inventaire des 14 écrans du prototype).
- Le prototype visuel « Prometis » (Claude Design) est la référence UI ; il est cohérent avec le schéma
  (ex. lot A02 = 850 000 → appel 15 % = 127 500).

## 8 bis. Où en est le développement

**Lots 0 à 6 livrés** (14 août 2026) — 289 tests verts — dépôt
[BonjourConseils/Prometis](https://github.com/BonjourConseils/Prometis).
Le fil rouge financier est complet ; le moteur d'appels de fonds tourne.
**Prochain : Lot 7, passerelle Kolabimo.**

État détaillé lot par lot, et surtout **la liste des sujets non livrés avec leur cause**
(OIDC, MFA, SMTP, extraction PDF, PDF de la QR-facture, notation multicritère) :
`.claude/skills/prometis-dev/references/roadmap.md`.

Reprendre sur une machine propre :
`npm ci && npm run db:bootstrap && npm run db:migrate && npm run db:seed && npm test`.

## 9. Où trouver le « comment »

- **Skill projet** : `.claude/skills/prometis-dev/` — conventions de code, mécanique RLS,
  commandes, chemin tenant des 40 tables, pièges vérifiés. À charger avant toute tâche de code.
- **Documentation Notion** (miroir de lecture, le dépôt reste maître) :
  [🏗️ PROMETIS](https://app.notion.com/p/3bca1a97d3dd8178bf46dfd7eb1bc381) sous la racine `🌐 SAAS`
  — 7 sections : Projet & Produit, Architecture, Modèle de données, Passerelle Kolabimo,
  Roadmap & Lots, Releases & Versions, Risques & Décisions.

## 10. Definition of Done (par module)

- Migrations Prisma + policies RLS testées (aucune fuite cross-tenant : test automatisé dédié).
- Endpoints validés (zod/DTO), erreurs typées, permissions (`Membership` + `OperationAccess`).
- Tests unitaires sur les règles métier (prix total acte, calcul appel de fonds, écart CFC, idempotence).
- Piste d'audit alimentée. Pas de secret en clair. Données hébergées en Suisse.
