# Prometis — Backlog de développement (MVP → V2)

> Ordre de construction recommandé. Chaque lot est livrable et testable indépendamment.
> Référence modèle : `prisma/schema.prisma`. Référence métier : `Plan_Prometis.md`.
> Règle transverse : à chaque lot, tests d'isolation multi-tenant (aucune fuite cross-tenant) + piste d'audit.

---

## Lot 0 — Fondations (scaffolding)
**But** : un dépôt qui démarre, migre la base et déploie.
- Monorepo (frontend Next.js + backend NestJS + `prisma/`), TypeScript strict, lint/format, CI.
- Docker + docker-compose (PostgreSQL, Redis), IaC minimal, hébergeur suisse.
- `prisma migrate` depuis le schéma fourni ; seed de démonstration (opération « Les Jardins de Prilly »).
- Mise en place **RLS** PostgreSQL : middleware qui pose `app.societe_id` par requête.
**Done** : la base se crée, l'app boote, un test prouve qu'un tenant ne lit pas les données d'un autre.

## Lot 1 — Socle multi-tenant, identité & accès
**But** : se connecter, choisir son espace, gérer les droits.
- `Compte` (login OIDC/MFA), `Membership` (appartenance multi-sociétés) + **sélecteur d'espace de travail**.
- `Societe` (profil + `modulesActifs`), `Actionnaire`, `ApiKey`.
- RBAC : `UtilisateurRole` + `OperationAccess` (niveau `READ_ONLY`/`OPERATE`/`MANAGE`, restreint par `AccessModule`).
- Écran **Droits d'accès** (internes + intervenants externes scopés). `AuditLog`.
**Done** : un compte CB Promotions bascule entre deux sociétés isolées ; une EG a un accès scopé par module.

## Lot 2 — Opérations, foncier & acteurs
**But** : créer une promotion et son cadre.
- `Operation` (foncier, `modeRealisation`, notaire, `maitreOuvrageActeurId`, `commercialisationActive`).
- `Parcelle` (+ registre foncier), `Bien`, `Lot`, `Parking` (4 types), `Ppe` (constitution, millièmes).
- `Acteur` (annuaire) + `OperationActeur` (rôles, mandataire général). Écrans **Opérations**, **Registre PPE**, **Acteurs**.
**Done** : fiche opération + bilan promoteur (coûts CFC vs recettes lots+parkings → marge).

## Lot 3 — Budget CFC  *(début du fil rouge financier)*
**But** : construire et versionner le budget.
- `CfcNode` (arbre N niveaux), `BudgetVersion` (initial/révisions, une courante), `LigneBudget`.
- Import trame CRB, TVA 8.1 %, ventilation par lot (quote-part PPE / surface / égalité).
- Écran **Budget CFC** (initial / révisé / adjugé / facturé / reste à engager).
**Done** : arborescence CFC éditable, totaux agrégés, versions.

## Lot 4 — Soumissions → adjudications → contrats
**But** : consulter, comparer, adjuger.
- `Entreprise`, `Soumission`, `SoumissionInvitation`, `Offre`, `Adjudication`, `Contrat` (SIA 118), `Avenant`.
- Report du montant adjugé sur le CFC ; génération contrat + retenue de garantie.
- Écran **Comparaison des offres** (notation pondérée, proposition, adjudication).
**Done** : d'une soumission à un contrat, la colonne « adjugé » du CFC se remplit.

## Lot 5 — Factures (OCR/IA) & écarts
**But** : classer les factures et voir l'écart en temps réel.
- `Facture` (champs + OCR : `ocrStatut`, `cfcSuggereId`, confiance), `PaiementFournisseur`.
- Rapprochement contrat, contrôle `facturé cumulé ≤ commandé`, circuit de validation humaine.
- Écran **Factures** + écran **Écarts** (Budgété → Adjugé → Commandé → Facturé → Payé par CFC).
**Done** : une facture lue est imputée au bon CFC après validation ; la vue écart est juste.

## Lot 6 — Ventes & appels de fonds
**But** : facturer les acquéreurs automatiquement.
- `Acquereur`, `Reservation` (statuts, prix total acte figé), `EcheancierEtape`, `AppelDeFonds`, `Encaissement`.
- Moteur : jalon `COMPLETED` → calcul par réservation → PDF + **QR-facture suisse** → e-mail → suivi + relances.
- Écrans **Lots & acquéreurs**, **Appels de fonds** (échéancier, génération par lot, encaissements).
**Done** : marquer un jalon terminé génère et envoie les appels de fonds ; idempotent.

## Lot 7 — Passerelle Kolabimo
**But** : synchroniser lots/clients et remonter les encaissements.
- Client API v1 (lecture promotions, lots, réservations) ; `WebhookEvent` (idempotent, HMAC).
- Consommer `reservation.*` (Kolabimo → Prometis) ; émettre `echeancier.etape_completed` + encaissements (Prometis → Kolabimo).
- Réconciliation par `externalId`. Endpoint Kolabimo à ajouter : `GET /promotions/:id/echeancier`.
**Done** : une réservation Kolabimo apparaît dans Prometis ; un jalon terminé alimente la trésorerie Kolabimo.

## Lot 8 — Modules annexes
**But** : compléter le périmètre chantier & gouvernance.
- **GED** (`Document` versionnée, rattachements, partage interne/externe).
- **Séances & PV** (`Seance`, `SeanceParticipant`, `SeancePoint`, génération PV → GED).
- **Courtage** (`MandatCourtage`, `MandatCourtageLot`, `CommissionCourtage`).
- **Trésorerie** (consolidation dépenses/recettes, reporting bancaire).
**Done** : chaque écran du prototype restant est fonctionnel.

---

## V2 (après MVP)
- **Portail acquéreur** (surface séparée, restreinte : avancement, appels reçus, TMA).
- Signature électronique **QES** (Skribble / DeepSign) des contrats et réservations.
- Intégrations **comptables** (Abacus / Bexio / Banana) et **bancaires** (ISO 20022 pain/camt).
- Import descriptifs **CAN/NPK** (SIA 451).
- **Multilingue** (DE/IT) pour l'extension nationale.

## Jalons de validation (pilotes réels)
- Promotions en cours (travaux non démarrés) → valider la saisie initiale (foncier, budget, soumissions).
- Immeuble livré dans ~3 mois → tout ressaisir et **comparer aux documents réels, factures payées et appels de fonds effectués**.
