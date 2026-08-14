# Passerelle Kolabimo (Lot 7)

Kolabimo est l'autre SaaS de l'écosystème (collaboration immobilière : promoteurs, agences,
agents ; Express.js + EJS + PostgreSQL/Prisma + SSE + webhooks n8n). Il est **source des lots,
des réservations et des clients**. Prometis est **maître de l'échéancier** et des appels de fonds.

## Qui est maître de quoi

| Donnée | Maître | Sens de synchro |
|---|---|---|
| Promotions, lots, parkings, prix | **Kolabimo** | Kolabimo → Prometis |
| Réservations, clients acquéreurs | **Kolabimo** | Kolabimo → Prometis (`reservation.*`) |
| Échéancier, fin de jalon | **Prometis** | Prometis → Kolabimo (`echeancier.etape_completed`) |
| Appels de fonds, encaissements | **Prometis** | Prometis → Kolabimo (alimente sa trésorerie) |

Ne jamais écrire un lot ou un prix côté Prometis pour une opération liée à Kolabimo : la
réconciliation le réécrasera.

## API v1 Kolabimo (existant)

Authentification : en-tête `x-api-key`, une clé **par société** (cf. `ApiKey` côté Prometis pour
le sens inverse).

- promotions
- lots (avec parkings **et** prix total acte déjà calculé)
- lots réservés + client
- réservations — création **idempotente** via `externalId`

## À ajouter côté Kolabimo

- `GET /api/v1/promotions/:id/echeancier`
- un webhook sortant `reservation.*`

## Webhooks

Signés **HMAC-SHA256**, idempotents des deux côtés.

- **Kolabimo → Prometis** : `reservation.*` (créée, modifiée, annulée, nouveau client).
  Journalisés dans `WebhookEvent` avec `dedupeKey` unique → rejouer ne retraite rien.
- **Prometis → Kolabimo** : `echeancier.etape_completed`, puis le statut des encaissements
  (issu de camt.054) pour fiabiliser la trésorerie de Kolabimo.

## Table de mapping

| Entité Prometis | Champ | Entité Kolabimo |
|---|---|---|
| `Operation` | `kolabimoPromotionId` | promotion |
| `Lot` | `kolabimoAppartementId` | appartement |
| `Parking` | `kolabimoParkingId` | parking |
| `Reservation` | `externalId` (unique) / `kolabimoReservationId` | réservation |
| `EcheancierEtape` | `kolabimoEtapeId` + `syncedAt` | étape d'échéancier |
| `Acquereur` | `kolabimoClientRef` | client |

## Séquence complète d'un appel de fonds

1. Dans Prometis, un jalon passe à `COMPLETED` avec `dateCompletion`.
2. Pour chaque réservation engagée de l'opération :
   `montant = EcheancierEtape.pourcentage × Reservation.prixTotalActe`.
3. Création de l'`AppelDeFonds` — unique `(reservationId, etapeId)`, donc rejouable sans doublon.
4. Génération PDF + **QR-facture suisse**, envoi e-mail à l'acquéreur (adresse issue de la
   réservation Kolabimo).
5. Suivi de l'encaissement (camt.053/054) et relances — ce que Kolabimo ne fait pas.
6. Push vers Kolabimo : `echeancier.etape_completed` puis les encaissements.
7. Réconciliation retour : Kolabimo notifie les évolutions de réservation, rapprochées par `externalId`.

## Pièges

- Une étape sans `pourcentage` (jalon de suivi chantier) ne génère **aucun** appel de fonds,
  mais est quand même synchronisée vers Kolabimo.
- `Reservation.prixTotalActe` est figé : si Kolabimo remonte un nouveau prix de lot après la
  signature de l'acte, il ne doit pas modifier les appels déjà émis.
- Les deux SaaS partagent les conventions Prisma (`@map` snake_case, `@@map` pluriel) — garder
  cet alignement pour que le mapping reste lisible.

## Alignement d'enums déjà fait

`ParkingType` (EXTERIEURE / INTERIEURE / COUVERTE / BOX / AUTRE), `ActeurType` (enrichi côté
Prometis : INGENIEUR, PILOTE), `EcheancierEtapeStatut` (NOT_STARTED / IN_PROGRESS / COMPLETED),
`OperationAccessLevel` (READ_ONLY / OPERATE / MANAGE) sont volontairement identiques à Kolabimo.
Ne pas les renommer.

---

## Ce qui est livré (Lot 7 — 14 août 2026)

Code dans `apps/api/src/passerelle/` · écran `apps/web/app/passerelle/` ·
tests `tests/passerelle.spec.ts` (purs) et `tests/passerelle-webhooks.spec.ts` (bout en bout).

| Fichier | Rôle |
|---|---|
| `signature.ts` | HMAC-SHA256 dans les deux sens, comparaison à temps constant, fenêtre anti-rejeu de 5 min, `construireDedupeKey` |
| `reconciliation.ts` | schémas zod des charges, traduction des statuts, **ce que Kolabimo n'a pas le droit de changer** |
| `kolabimo.client.ts` | API v1 sortante, signée ; « non configuré » ≠ « en panne » |
| `passerelle.service.ts` | réception, traitement, boîte d'envoi, journal, rejeu, reprise tirée |
| `passerelle.controller.ts` | `POST /webhooks/kolabimo` (public, authentifié par clé + HMAC), `/passerelle/etat`, `/passerelle/journal`, rejeu, import |

### Endpoints

- `POST /webhooks/kolabimo` — entrant. `x-api-key` + `x-kolabimo-signature: t=…,v1=…`.
- `GET  /passerelle/etat` — raccordement, clés acceptées (jamais leur valeur), compteurs.
- `GET  /passerelle/journal?source=&statut=&limite=` — journal filtré **applicativement** par société.
- `POST /passerelle/journal/:id/rejouer` — retraite un entrant, relivre un sortant. OWNER/ADMIN.
- `POST /operations/:id/passerelle/importer-reservations` — reprise tirée, même chemin que les webhooks.

### Événements

Entrants pris en charge : `reservation.created`, `reservation.updated`, `reservation.cancelled`,
`lot.updated`. Tout autre type → `IGNORE` (pas `ERREUR`) : Kolabimo peut pousser plus que ce
qu'on consomme.

Sortants : `echeancier.etape_completed` (clé `opérationId-étapeId`) et `encaissement.enregistre`
(clé = id de l'encaissement).

### Statuts d'un événement au journal

`RECU` déposé, pas encore livré · `TRAITE` appliqué / livré · `IGNORE` hors périmètre, volontaire ·
`ERREUR` demande un humain, avec la raison en clair.

### Migration

`20260814200000_lot7_passerelle_kolabimo` : `app.societe_de_cle_api(text)` (SECURITY DEFINER,
inventoriée dans `app.security_definer_autorisees`) + deux index sur `webhook_events`.

### Clés de développement

`prisma/passerelle-cles-dev.ts`, une par société du seed. Elles servent **à la fois**
d'identifiant de tenant et de secret de signature. Valeurs publiques : à régénérer avant toute
mise en ligne.
