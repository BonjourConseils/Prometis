# Roadmap, lots et versions

## Où en est le développement (15 août 2026)

| Lot | État | Ce qui existe |
|---|---|---|
| **0** Fondations | ✅ livré | monorepo, 40 tables, 38 policies RLS, seed 2 tenants |
| **1** Identité & accès | ✅ livré | argon2id + JWT en deux temps, espaces de travail, RBAC à 3 étages, audit |
| **2** Opérations & foncier | ✅ livré | parcelles, biens, lots, parkings, PPE, acteurs, **bilan promoteur** |
| **3** Budget CFC | ✅ livré | arbre agrégé N niveaux, versions, ventilation par lot |
| **4** Soumissions → contrats | ✅ livré | comparaison au net, adjudication, contrat SIA 118, avenants |
| **5** Factures & écarts | ✅ livré | lecture des champs, rapprochement CFC, contrôle du cumul, écran Écarts |
| **6** Ventes & appels de fonds | ✅ livré | réservations à prix figé, échéancier, **moteur idempotent + QR + e-mail** |
| **7** Passerelle Kolabimo | ✅ livré | webhooks signés + dédoublonnés, boîte d'envoi rejouable, journal étanche |
| **8** Modules annexes | ✅ livré | GED versionnée, séances & PV, courtage, trésorerie |

**377 tests verts**, suite idempotente (elle peut être relancée sans reseed).
**Le périmètre MVP est épuisé** : la suite est la V2, à n'engager qu'après les jalons pilotes.
Dépôt : https://github.com/BonjourConseils/Prometis — un commit par lot, message détaillé.

Le **fil rouge financier est complet** : `Budgété → Adjugé → Commandé → Facturé → Payé` se lit
poste CFC par poste CFC. C'est la valeur différenciante du produit, et elle est en place.

## Ce qui n'a PAS été fait, et pourquoi

Aucun de ces points n'est un oubli. Chacun attend un arbitrage, et le code est écrit pour
l'accueillir sans réécriture.

| Sujet | Bloqué par | Où c'est isolé |
|---|---|---|
| **OIDC** | choix du fournisseur (Docker absent, pas de Keycloak local) | `PasswordService` + `TokenService` |
| **MFA** | *le schéma ne porte ni secret TOTP ni codes de secours* | — |
| **Fournisseur SMTP** | choix d'un serveur suisse + secrets en coffre | `MAIL_TRANSPORT=console` |
| **Extraction PDF → texte** | choix d'un service compatible nLPD | `extraction.ts` part du texte |
| **PDF de la QR-facture** | choix du stockage de documents (S3 suisse) | mention en clair dans l'e-mail |
| **Notation multicritère des offres** | `Offre` n'a aucun champ de score | note de *prix*, nommée comme telle |
| **Circuit de validation multi-approbateurs** | `Facture.validePar` ne porte qu'un validateur | rôles + statuts + `AuditLog` |
| **Identifiants Kolabimo par société** | une seule paire URL/clé par instance ; il faudrait un champ de schéma ou un coffre | `KOLABIMO_API_URL` / `KOLABIMO_API_KEY` |
| **Séparation identifiant / secret de signature** | `ApiKey` ne porte qu'un champ `key`, qui sert des deux côtés | `signature.ts`, un seul secret à échanger |
| **`GET /promotions/:id/echeancier` côté Kolabimo** | endpoint à écrire dans l'autre dépôt | `KolabimoClient.lireEcheancier()` prêt à l'appeler |
| **Object storage suisse (S3)** | choix de l'hébergeur — engage la localisation des données (nLPD) | `STOCKAGE_TRANSPORT=local`, un seul fichier à changer |
| **PV en PDF mis en page** | choix d'un moteur de rendu, même décision que la QR-facture | `pv.ts` produit du Markdown, lisible tel quel |

Ne pas « débloquer » l'un de ces points en contournant le schéma ou en branchant un fournisseur
sans arbitrage : c'est précisément ce que ces lignes servent à empêcher.

---


## Correspondance lots ↔ phases ↔ modules

`BACKLOG.md` découpe en **lots livrables** ; `Plan_Prometis.md` §8.2 découpe en **phases**
calendaires ; §5.2 nomme les **modules A→P**. Les trois vues se recoupent ainsi :

| Lot | Phase (plan §8.2) | Modules | Version |
|---|---|---|---|
| **0** Fondations (scaffolding) | 1 — Socle & multi-tenant | — | MVP |
| **1** Socle multi-tenant, identité & accès | 1 — Socle & multi-tenant | — | MVP |
| **2** Opérations, foncier & acteurs | 1 — Socle & multi-tenant | A | MVP |
| **3** Budget CFC | 2 — Fil rouge financier | B | MVP |
| **4** Soumissions → adjudications → contrats | 2 — Fil rouge financier | C, D, E | MVP |
| **5** Factures (OCR/IA) & écarts | 2 — Fil rouge financier | F, G | MVP |
| **6** Ventes & appels de fonds | 3 — Ventes & appels de fonds | H, I | MVP |
| **7** Passerelle Kolabimo | 3 — Ventes & appels de fonds | — | MVP |
| **8** Modules annexes (GED, séances, courtage, trésorerie) | 4 — Pilote & durcissement | J, K | MVP |
| — | 5 — V2 | L, M, N | V2 |
| — | 6 — V3 | O, P | V3 |

MVP visé en ~5 à 7 mois selon l'équipe et la disponibilité des promoteurs pilotes.

## Le fil rouge d'abord

Ordre imposé par le plan §8.1 : le fil rouge financier (Lots 3→5) passe **avant** la vente
(Lot 6) et avant la passerelle (Lot 7), parce que c'est la valeur différenciante. Ne pas
réordonner sans décision produit explicite.

## Detail des lots

### Lot 0 — Fondations
Monorepo (Next.js + NestJS + `prisma/`), TS strict, lint/format, CI. Docker-compose
(PostgreSQL, Redis). `prisma migrate` depuis le schéma fourni. Seed « Les Jardins de Prilly ».
RLS + middleware qui pose `app.societe_id`.
**Done** : la base se crée, l'app boote, un test prouve qu'un tenant ne lit pas l'autre.

### Lot 1 — Socle multi-tenant, identité & accès
`Compte` (OIDC/MFA), `Membership` + sélecteur d'espace, `Societe` (profil + `modulesActifs`),
`Actionnaire`, `ApiKey`. RBAC `UtilisateurRole` + `OperationAccess`. Écran Droits d'accès. `AuditLog`.
**Done** : un compte bascule entre deux sociétés isolées ; une EG a un accès scopé par module.

### Lot 2 — Opérations, foncier & acteurs
`Operation`, `Parcelle`, `Bien`, `Lot`, `Parking`, `Ppe`, `Acteur` + `OperationActeur`.
Écrans Opérations, Registre PPE, Acteurs.
**Done** : fiche opération + bilan promoteur (coûts CFC vs recettes lots+parkings → marge).

### Lot 3 — Budget CFC
`CfcNode`, `BudgetVersion`, `LigneBudget`. Import trame CRB, TVA 8.1 %, ventilation par lot.
Écran Budget CFC (initial / révisé / adjugé / facturé / reste à engager).
**Done** : arborescence éditable, totaux agrégés, versions.

### Lot 4 — Soumissions → adjudications → contrats
`Entreprise`, `Soumission`, `SoumissionInvitation`, `Offre`, `Adjudication`, `Contrat`, `Avenant`.
Report de l'adjugé sur le CFC, génération de contrat, retenue de garantie. Écran Comparaison des offres.
**Done** : d'une soumission à un contrat, la colonne « adjugé » du CFC se remplit.

### Lot 5 — Factures (OCR/IA) & écarts
`Facture` (+ OCR : `ocrStatut`, `cfcSuggereId`, confiance), `PaiementFournisseur`. Rapprochement
contrat, contrôle `facturé ≤ commandé`, circuit de validation. Écrans Factures et Écarts.
**Done** : une facture lue est imputée au bon CFC après validation ; la vue écart est juste.

### Lot 6 — Ventes & appels de fonds
`Acquereur`, `Reservation`, `EcheancierEtape`, `AppelDeFonds`, `Encaissement`. Moteur : jalon
`COMPLETED` → calcul par réservation → PDF + QR-facture suisse → e-mail → suivi + relances.
Écrans Lots & acquéreurs, Appels de fonds.
**Done** : marquer un jalon terminé génère et envoie les appels de fonds ; idempotent.

### Lot 7 — Passerelle Kolabimo ✅
Voir `kolabimo-gateway.md`. Livré : `POST /webhooks/kolabimo` authentifié par clé + HMAC sur le
corps brut, journalisé dans `WebhookEvent` avec `dedupeKey` unique ; réconciliation des
`reservation.*` et `lot.updated` par `externalId` ; boîte d'envoi sortante
(`echeancier.etape_completed`, `encaissement.enregistre`) écrite dans la transaction métier et
livrée après le commit ; reprise tirée `POST /operations/:id/passerelle/importer-reservations` ;
écran Passerelle (état, journal, rejeu).
**Done, vérifié** : une réservation Kolabimo apparaît dans Prometis (38 tests, dont l'idempotence
d'un rejeu et l'étanchéité du journal entre tenants) ; un jalon terminé dépose son événement pour
la trésorerie Kolabimo, même passerelle non configurée.

### Lot 8 — Modules annexes ✅
GED (`Document` versionnée), Séances & PV, Courtage, Trésorerie.
**Done, vérifié** : les quatre écrans restants du prototype sont fonctionnels et alimentés par
le seed. 50 tests, dont l'assainissement des chemins de fichier, le versionnage qui n'écrase
jamais, l'assiette TTC d'une commission, et le comblement des mois sans mouvement.

Livré : `StockageService` à point de sortie unique (transport `local` en développement, refusé
en production) ; GED versionnée avec rattachement à l'un des onze parents, contrôlé contre
l'opération de la route ; séances, participants, points d'action et **génération du PV déposée
en GED** ; mandats de courtage avec périmètre, exclusivité contrôlée et calcul de commission
pur ; trésorerie consolidée mois par mois avec position, creux et créances attendues.

## V2 / V3

- **V2** : portail acquéreur (surface séparée : avancement, appels reçus, TMA), signature QES
  (Skribble / DeepSign), intégrations comptables (Abacus / Bexio / Banana) et bancaires
  (ISO 20022 pain/camt), import CAN/NPK (SIA 451).
- **V3** : planning chantier avancé (Gantt, journal, photos, réserves), analytique & IA
  (ratios CHF/m², benchmark, détection d'anomalies), multilingue DE/IT.

## Les 14 écrans du prototype (plan §9.1)

Dashboard · Fiche opération / Bilan promoteur · Budget CFC · Écarts · Comparaison des offres ·
Factures · Lots PPE · Appels de fonds · Registre PPE · Acteurs & courtage · Séances & PV · GED ·
Droits d'accès · Portail acquéreur (V2).

Cohérence de référence à préserver : lot A02 = 850 000 CHF → 5 % = 42 500, 15 % = 127 500 ;
Immeuble A (12 lots) + Immeuble B (8 lots) = 20 lots PPE, parcelles 2841 / 2842.

## Jalons de validation (pilotes réels)

1. Promotions en cours, travaux non démarrés → valider la saisie initiale (foncier, budget, soumissions).
2. Immeuble livré dans ~3 mois → tout ressaisir et **comparer aux documents réels**, factures
   payées et appels de fonds effectués.

## Risques suivis (plan §8.5)

| Risque | Parade |
|---|---|
| Complexité métier sous-estimée (CFC, SIA 118, cantons) | expert métier embarqué, pilotes, périmètre resserré |
| **Fuite de données entre tenants** | RLS, tests d'isolation automatisés à chaque lot, revues |
| Habitude d'Excel | import Excel, valeur immédiate sur le fil rouge, onboarding accompagné |
| Dépendance aux intégrations tierces | exports standard (ISO 20022, CAN/NPK) d'abord |
| Scope creep | gouvernance de backlog stricte, jalons go/no-go |
