# Modèle de données — 40 tables, 30 enums

`prisma/schema.prisma` est **la** source de vérité. Ce fichier en donne la carte et les invariants
qui ne se lisent pas dans le schéma.

## 1. Tenant, identité, accès (6)

`Societe` · `Compte` · `Membership` · `Actionnaire` · `ApiKey` · `OperationAccess`

- Le tenant est la **`Societe`**, pas l'utilisateur. `Societe.profil` (PROMOTEUR, ENTREPRISE_GENERALE,
  ARCHITECTE, BUREAU_TECHNIQUE, REGIE) détermine `modulesActifs` par défaut.
- `Compte` = login unique par personne ; `Membership` = appartenance à une société (unique
  `(compteId, societeId)`) → un sélecteur d'espace de travail côté UI.
- Un membre externe (EG, notaire) a un `Membership.acteurId` qui le rattache à sa société-acteur.
- Droits = `Membership.role` **puis** `OperationAccess` (`READ_ONLY`/`OPERATE`/`MANAGE` +
  `modules: AccessModule[]`, vide = tout ce que le niveau permet).

## 2. Opération, foncier, biens, lots (7)

`Operation` · `Acteur` · `OperationActeur` · `Bien` · `Lot` · `Parking` · `Parcelle`

- Hiérarchie : `Operation` → `Bien` (LOTISSEMENT/VILLA/IMMEUBLE/CHALET) → `Lot` → `Parking`.
- `Operation.commercialisationActive = false` → chantier piloté par une EG/architecte sans
  promoteur : aucun module de vente.
- `Operation.modeRealisation` : `ENTREPRISE_GENERALE` | `MANDAT_ARCHITECTE` | `CORPS_DETAT_SEPARES`.
  `OperationActeur.estMandataireGeneral` marque celui qui « se charge de tout ».
- **`Lot` et `Parking` ne portent pas `societe_id`** — ils passent par `Bien` → `Operation`.

## 3. CFC & budget (3)

`CfcNode` · `BudgetVersion` · `LigneBudget`

- `CfcNode` : arbre N niveaux par adjacency list (`parentId`), unique `(operationId, code)`.
  Codes du type `2` → `27` → `271` → `271.0`.
- `BudgetVersion` : une seule `isCourant = true` par opération — **invariant à faire respecter en
  applicatif** (le schéma ne l'impose pas).
- `LigneBudget.estReserve` = provision/imprévus, à isoler dans les totaux.
- Ventilation d'une ligne sur plusieurs lots (quote-part PPE / surface / égalité) : logique
  applicative, pas de table dédiée.

## 4. Soumissions → adjudications → contrats (7)

`Entreprise` · `Soumission` · `SoumissionInvitation` · `Offre` · `Adjudication` · `Contrat` · `Avenant`

- Chaîne : `Soumission` (sur un `CfcNode`) → `Offre` par `Entreprise` → `Adjudication`
  (1-1 avec la soumission **et** avec l'offre) → `Contrat` (SIA 118) → `Avenant`.
- « **Commandé** » d'un poste CFC = `Contrat.montant` + Σ `Avenant.montant` (les avenants sont
  signés : + ou −).
- `Contrat.retenueGarantiePct`, `finGarantie` (2 ans) : mécanique SIA 118.

## 5. Factures & paiements fournisseurs (2)

`Facture` · `PaiementFournisseur`

- OCR/IA remplit fournisseur, numéro, dates, HT/TVA/TTC, réf. QR et **propose** `cfcSuggereId`
  avec `ocrConfiance`. `cfcNodeId` n'est rempli qu'après validation humaine.
- Statuts : `RECUE` → `EN_LECTURE` → `A_VALIDER` → `VALIDEE` → `PAYEE` (+ `LITIGE`, `REJETEE`).
- Contrôle bloquant : `Σ factures validées d'un contrat ≤ commandé`.

## 6. Ventes, échéancier, appels de fonds (5)

`Acquereur` · `Reservation` · `EcheancierEtape` · `AppelDeFonds` · `Encaissement`

- `Reservation.prixTotalActe` est **figé** à la vente = `Lot.prixVente` + Σ `Parking.prix`.
- `EcheancierEtape` : unique `(operationId, ordre)`. `pourcentage` nullable — Σ des non-nuls = 100 %.
  Étape 1 = signature de l'acte (lot par lot) ; les suivantes = jalons de chantier (tous les lots
  engagés).
- `EcheancierEtape.statut = COMPLETED` + `dateCompletion` = **le déclencheur** des appels de fonds.
- `AppelDeFonds` unique `(reservationId, etapeId)` → idempotence. `montant = pourcentage ×
  prixTotalActe`.
- `Encaissement` : rapprochement camt.053/054, plus `confirmeParId` (ex. le notaire confirme
  l'arrivée des fonds).

## 7. Passerelle & audit (2)

`WebhookEvent` · `AuditLog`

- `WebhookEvent.dedupeKey` unique → rejouer un webhook ne retraite rien.
- `AuditLog` : `societeId`, `action` (`"facture.validee"`, `"etape.completed"`…), `entite`,
  `entiteId`, `donnees` JSON.

## 8. GED (1)

`Document` — 24 catégories. Versionnage par `parentDocumentId` + `version` + `isCourant`.
Rattachements optionnels multiples (opération, lot, soumission, contrat, facture, réservation,
acteur, séance, parcelle, ppe, mandat de courtage). `visibiliteExterne` pour le partage
notaire/banque/acquéreur.

## 9. Séances & PV (3)

`Seance` · `SeanceParticipant` · `SeancePoint`

Types : CHANTIER, ADJUDICATION, COPIL, PROMOTEUR, TECHNIQUE, CLIENT_ACQUEREUR, NOTAIRE.
Le PV généré est stocké comme `Document` (catégorie `PV_SEANCE`) rattaché à la séance.

## 10. PPE (1)

`Ppe` — acte constitutif, règlement, `totalMillemes` (défaut 1000). Les `Lot.quotePartPPE`
s'y rapportent ; **contrôle applicatif** : Σ des quotes-parts d'un immeuble = `totalMillemes`.

## 11. Courtage (3)

`MandatCourtage` · `MandatCourtageLot` · `CommissionCourtage`

Commission `POURCENTAGE` ou `FORFAIT`, `assietteTtc`, périmètre `TOUTE_OPERATION` ou
`LOTS_SELECTIONNES` (→ `MandatCourtageLot`). `CommissionCourtage` est due par réservation.

## Invariants non portés par le schéma

À implémenter et tester en applicatif :

1. Une seule `BudgetVersion.isCourant` par opération.
2. Σ `EcheancierEtape.pourcentage` (non nuls) = 100 % par opération.
3. Σ `Lot.quotePartPPE` = `Ppe.totalMillemes` par immeuble.
4. Σ factures validées d'un contrat ≤ contrat + avenants.
5. `Reservation.prixTotalActe` ne se recalcule pas après `dateSignatureActe`.
6. Un `AppelDeFonds` n'existe que si `EcheancierEtape.pourcentage IS NOT NULL`.
