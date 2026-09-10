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
- **Déclencheur des appels de fonds** : le jalon est marqué **dans Kolabimo** (changé le
  02.09.2026 — c'est ce qui informe les agences, et un promoteur n'est pas obligé d'avoir
  Prometis). Kolabimo pousse `echeancier.etape_completed` → pour chaque réservation engagée,
  `montant = pourcentage × prix total acte` → **deux documents** (lettre à l'acquéreur +
  bordereau QR pour sa banque) → envoi e-mail à **toutes** les personnes du dossier → suivi
  encaissement (camt.054) → push du statut vers Kolabimo. **Au premier appel d'un lot**, les
  étapes déjà closes sont proposées **au choix** du promoteur : certaines figurent dans l'acte.
- **Dossier acquéreur** : N personnes par réservation (couple, indivision, société), avec rôle
  et quote-part **en fraction**. Kolabimo ne livre l'identité qu'au palier `FONDS_VERSES` :
  avant, une réservation n'a qu'une référence pseudonyme et **aucun acquéreur nominatif**.
- **Idempotence** : unicité `(reservationId, etapeId)` sur `AppelDeFonds` ; `dedupeKey` sur
  `WebhookEvent` ; `externalId` sur `Reservation` (réconciliation avec Kolabimo).
- **Créance solidaire** : la quote-part figure à l'acte mais ne divise **pas** le montant
  appelé. Chaque personne du dossier reçoit la totalité ; un seul versement la solde.
- **CFC** : arbre à N niveaux (`CfcNode.parentId`). Un poste agrège budgété / adjugé / facturé.
  Une ligne de budget peut être ventilée sur plusieurs lots (quote-part PPE / surface / égalité).
- **Factures** : OCR/IA extrait fournisseur, n°, dates, HT/TVA/TTC, réf. QR ; **propose** un CFC
  (`cfcSuggereId`) rapproché du contrat ; contrôle `facturé cumulé ≤ commandé` ; **validation humaine**
  obligatoire (circuit chef de projet → direction → comptabilité).

## 6. Passerelle Kolabimo (voir §6.5 du plan)

- Kolabimo expose une **API v1** (clé `x-api-key` **de promoteur**, cloisonnée depuis SEC1) :
  promotions, lots (avec parkings + prix total acte), échéancier, réservations (sans identité).
- **La clé se saisit dans Prometis, par société** (écran Passerelle, table `connexions_kolabimo`,
  chiffrée). Prometis génère en retour l'URL et le **secret de webhook**, distinct de la clé, que
  le promoteur colle dans Kolabimo — « Ma société → Intégrations & API ».
- Webhooks : Kolabimo → Prometis (`reservation.*` **et** `echeancier.etape_completed`) ;
  Prometis → Kolabimo (statut des encaissements). Signés HMAC-SHA256, idempotents.
  **Deux contrats circulent** — celui de Kolabimo (en-têtes `X-Kolabimo-Event` / `-Delivery`,
  signature hexadécimale nue) et le nôtre. Détail dans la référence du skill.
- Mapping : `kolabimoPromotionId` (Operation), `kolabimoAppartementId` (Lot),
  `kolabimoParkingId` (Parking), `externalId` / `kolabimoReservationId` (Reservation),
  `kolabimoEtapeId` (EcheancierEtape), `kolabimoClientRef` + `ordre` (Acquereur — une personne
  du dossier). Le rapprochement d'une réservation se fait par `kolabimoReservationId` :
  `externalId` est nul pour toute réservation posée dans l'interface de Kolabimo.

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

**Lots 0 à 9 livrés** (15 août 2026), plus les quatre changements Kolabimo du 2 septembre
2026 et la connexion Kolabimo par société (10 septembre) — 492 tests verts —
dépôt [BonjourConseils/Prometis](https://github.com/BonjourConseils/Prometis).
Le périmètre MVP est complet ET les décisions d'hébergement sont branchées : MFA TOTP,
stockage S3 Infomaniak, SMTP `noreply@prometis.ch`, QR-facture en PDF jointe aux appels de
fonds, extraction OCR auto-hébergée.
**Prochain : les jalons de validation sur des promotions réelles.** C'est le second qui vaut
go/no-go — il confronte les calculs du produit à une opération dont on connaît la vérité
comptable. La V2 (portail acquéreur, signature QES, intégrations comptables et bancaires) ne
s'engage qu'après.

État détaillé lot par lot, et surtout **la liste des sujets non livrés avec leur cause**
(OIDC, notation multicritère, circuit multi-approbateurs, identité des dossiers Kolabimo
antérieurs à la connexion, PV en PDF) : `.claude/skills/prometis-dev/references/roadmap.md`.

Reprendre sur une machine propre :
`npm ci && npm run db:bootstrap && npm run db:migrate && npm run db:seed && npm run verifier`.
(`npm test` seul échoue : une partie des tests tape l'API, que `verifier` démarre.)

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
