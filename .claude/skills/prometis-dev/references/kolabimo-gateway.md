# Passerelle Kolabimo (Lot 7)

Kolabimo est l'autre SaaS de l'écosystème (collaboration immobilière : promoteurs, agences,
agents ; Express.js + EJS + PostgreSQL/Prisma + SSE + webhooks n8n). Il est **source des lots,
des réservations et des clients**. Prometis est **maître des appels de fonds** et des
encaissements.

> **Changé le 2 septembre 2026** (dossier ACQ1, 32 décisions). Quatre choses ont bougé, plus
> une cinquième qu'il a fallu régler d'abord : les deux produits n'avaient pas le même contrat
> de webhook, et aucun message réel ne serait passé. Voir « Le contrat réel » plus bas.
> Prometis n'est **plus** maître de la fin de jalon.

## Qui est maître de quoi

| Donnée | Maître | Sens de synchro |
|---|---|---|
| Promotions, lots, parkings, prix | **Kolabimo** | Kolabimo → Prometis |
| Réservations, clients acquéreurs | **Kolabimo** | Kolabimo → Prometis (`reservation.*`) — **identité à `FONDS_VERSES` seulement**, référence pseudonyme avant |
| Échéancier : définition **et fin de jalon** | **Kolabimo** *(changé le 02.09.2026, était Prometis)* | Kolabimo → Prometis (`echeancier.etape_completed`, flèche inversée) |
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

## Le contrat réel des webhooks entrants (Kolabimo v1.3.0)

**Deux contrats circulent, et il faut le savoir avant de toucher à la réception.**

| | Kolabimo (production) | Interne (fil sortant, tests) |
|---|---|---|
| Signature | empreinte **hexadécimale nue** du corps brut | `t=<unix>,v1=<hmac>` |
| Événement | en-tête `X-Kolabimo-Event` | champ `evenement` du corps |
| Déduplication | en-tête `X-Kolabimo-Delivery` | champ `idEvenement` |
| Corps | `{ event, delivery, emisLe, reservation: {…} }` | `{ evenement, idEvenement, donnees }` |

`contrat-kolabimo.ts` ramène les deux à une forme unique. **Le corps Kolabimo ne porte pas la
promotion** : l'opération se retrouve par le lot (`kolabimoAppartementId`), ce qui donne au
passage le bon comportement hors périmètre — pas de lot, donc `IGNORE`.

La signature nue n'a pas de fenêtre anti-rejeu propre : c'est `X-Kolabimo-Delivery` et
l'unicité de `dedupeKey` en base qui rendent un rejeu inoffensif. C'est le contrat publié ;
la forme horodatée reste en place pour le jour où Kolabimo l'adoptera.

Événements Kolabimo : `reservation.created` · `reservation.step_changed` ·
`reservation.validated` · `reservation.cancelled` · `reservation.expired` ·
`echeancier.etape_completed`. Kolabimo ne réessaie pas (best-effort) ; la reprise passe par
`GET /promotions/:id/echeancier` et `GET /reservations`.

## Le dossier acquéreur : N personnes, et l'identité au palier

Avant `FONDS_VERSES`, `reservation.*` porte **la seule référence pseudonyme**
(`client: { reference }`) — pas un nom vide, pas un e-mail nul : le champ est absent. Prometis
crée donc la réservation **sans acquéreur nominatif** (`Reservation.acquereurId` est
facultatif). Au palier, `client.personnes[]` arrive : N personnes, chacune avec `role`,
`quotePart` **en fraction** (« 1/2 », jamais un pourcentage) et `signataire`.

- Le dossier vit dans `ReservationAcquereur` (policy RLS via `app.is_tenant_reservation`).
- `Reservation.acquereurId` n'est plus qu'un **contact principal dérivé** — le signataire, à
  défaut la première personne. Pas une seconde vérité : il est réécrit à chaque synchro.
- La clé d'upsert d'une personne est `(societeId, kolabimoClientRef, ordre)` : Kolabimo ne
  donne pas d'identifiant par personne.
- **`personnes` absent ≠ `personnes: []`.** Absent = « rien de neuf », on ne touche à rien.
  Vide = « plus personne ». Les confondre efface l'identité au premier événement suivant.
- Les appels sont **solidaires** : le montant n'est pas divisé par la quote-part, et tous les
  destinataires reçoivent l'envoi.

## À ajouter côté Kolabimo

- `GET /api/v1/promotions/:id/echeancier` *(fait le 02.09.2026, branche
  `sec1-cloisonnement-api-v1`, non déployé)*

## Webhooks

Signés **HMAC-SHA256**, idempotents des deux côtés.

- **Kolabimo → Prometis** : `reservation.*` (créée, modifiée, annulée, nouveau client).
  Journalisés dans `WebhookEvent` avec `dedupeKey` unique → rejouer ne retraite rien.
- **Prometis → Kolabimo** : le statut des encaissements (issu de camt.054) pour fiabiliser la
  trésorerie de Kolabimo. **Plus `echeancier.etape_completed`** : la flèche s'est inversée le
  02.09.2026.

## Table de mapping

| Entité Prometis | Champ | Entité Kolabimo |
|---|---|---|
| `Operation` | `kolabimoPromotionId` | promotion |
| `Lot` | `kolabimoAppartementId` | appartement |
| `Parking` | `kolabimoParkingId` | parking |
| `Reservation` | `externalId` (unique) / `kolabimoReservationId` | réservation |
| `EcheancierEtape` | `kolabimoEtapeId` + `syncedAt` *(= « aligné sur le maître »)* | étape d'échéancier |
| `Acquereur` | `kolabimoClientRef` + `ordre` | une personne du client |
| `Reservation` | `kolabimoClientRef` | le dossier client |
| `ReservationAcquereur` | — | `client.personnes[]` |

## Séquence complète d'un appel de fonds

1. **Dans Kolabimo**, le promoteur ou la DT marque le jalon `COMPLETED` ; Kolabimo pousse
   `echeancier.etape_completed`. Le marquer depuis Prometis sur une opération reliée est
   **refusé (409)** — un seul endroit déclenche des factures.
2. Pour chaque réservation engagée de l'opération :
   `montant = EcheancierEtape.pourcentage × Reservation.prixTotalActe`.
   **Sauf au premier appel d'un lot** : les étapes déjà closes sont proposées **au choix** du
   promoteur (`GET`/`POST /operations/:id/reservations/:rid/rattrapage`), certaines figurant
   dans l'acte et ayant été réglées chez le notaire.
3. Création de l'`AppelDeFonds` — unique `(reservationId, etapeId)`, donc rejouable sans doublon.
4. Génération de **deux documents** : une **lettre à l'acquéreur** (`lettre-acquereur.pdf.ts`)
   et un **bordereau QR destiné à sa banque** (`qr-facture.pdf.ts`), qui paie le plus souvent
   à sa place. Envoi à **toutes** les personnes du dossier ayant une adresse.
5. Suivi de l'encaissement (camt.053/054) et relances — ce que Kolabimo ne fait pas.
6. Push vers Kolabimo : les encaissements.
7. Réconciliation retour : Kolabimo notifie les évolutions de réservation, rapprochées par `externalId`.

## Pièges

- Une étape sans `pourcentage` (jalon de suivi chantier) ne génère **aucun** appel de fonds.
  Rien n'est poussé vers Kolabimo : c'est lui qui tient l'avancement.
- Une réservation **sans nom ni e-mail est normale** avant `FONDS_VERSES`. Ne pas lever, ne pas
  inventer un acquéreur « inconnu » : garder la référence, attendre l'événement du palier.
  Un appel de fonds créé à ce stade reste en échec d'envoi, faute de destinataire — et c'est
  la bonne réponse.
- **Le rattrapage n'est jamais automatique.** Un lot vendu en cours de chantier n'appelle pas
  d'office les tranches passées : elles peuvent figurer dans l'acte.
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
| `signature.ts` | HMAC-SHA256 dans les deux sens, comparaison à temps constant, fenêtre anti-rejeu de 5 min sur la forme horodatée, `empreinteNue` pour le contrat Kolabimo, `construireDedupeKey` |
| `contrat-kolabimo.ts` | schémas et normalisation du **contrat publié** : en-têtes, corps nommé par sujet, `client.personnes[]` |
| `reconciliation.ts` | schémas zod des charges, traduction des statuts, **ce que Kolabimo n'a pas le droit de changer** |
| `kolabimo.client.ts` | API v1 sortante, signée ; « non configuré » ≠ « en panne » |
| `passerelle.service.ts` | réception, traitement, boîte d'envoi, journal, rejeu, reprise tirée |
| `passerelle.controller.ts` | `POST /webhooks/kolabimo` (public, authentifié par clé + HMAC), `/passerelle/etat`, `/passerelle/journal`, rejeu, import |

### Endpoints

- `POST /webhooks/kolabimo` — entrant. `x-api-key` + `x-kolabimo-signature` (hex nu **ou**
  `t=…,v1=…`), plus `x-kolabimo-event` / `x-kolabimo-delivery` sur le contrat Kolabimo.
- `GET  /passerelle/etat` — raccordement, clés acceptées (jamais leur valeur), compteurs.
- `GET  /passerelle/journal?source=&statut=&limite=` — journal filtré **applicativement** par société.
- `POST /passerelle/journal/:id/rejouer` — retraite un entrant, relivre un sortant. OWNER/ADMIN.
- `POST /operations/:id/passerelle/importer-reservations` — reprise tirée, même chemin que les webhooks.

### Événements

Entrants pris en charge : `reservation.created`, `reservation.updated`,
`reservation.step_changed`, `reservation.validated`, `reservation.expired`,
`reservation.cancelled`, `echeancier.etape_completed`, `lot.updated`. Tout autre type →
`IGNORE` (pas `ERREUR`) : Kolabimo peut pousser plus que ce qu'on consomme.

Sortants : `encaissement.enregistre` (clé = id de l'encaissement). C'est le seul depuis le
02.09.2026.

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


---

## Connexion par société (10 septembre 2026)

| Sens | Secret | D'où il vient | Sert à |
|---|---|---|---|
| Prometis → Kolabimo | clé d'API `kolabimo_…` | générée par le promoteur dans Kolabimo, collée dans Prometis | lire promotions, lots, échéancier, réservations |
| Kolabimo → Prometis | secret de webhook | généré par Prometis, montré une fois, collé dans Kolabimo | signer (HMAC hex nu) ce que Kolabimo pousse |

URL à coller dans Kolabimo : `PUBLIC_API_URL/webhooks/kolabimo/<jeton>`. Le jeton désigne la
société ; il n'est pas un secret, la signature l'est.

Endpoints Prometis : `GET/PUT/DELETE /passerelle/kolabimo`, `POST …/tester`, `POST …/secret`
(régénère), `GET …/promotions`, `GET …/promotions/:id` (photo, lecture seule),
`POST …/promotions/:id/rattacher` `{ operationId? }`, `POST /operations/:id/passerelle/synchroniser`.

Routes Kolabimo réellement appelées (relevées dans son code, 1.3.20) : `GET /api/v1/me`,
`/promotions`, `/promotions/:id/lots`, `/promotions/:id/echeancier`, `/reservations` (non filtré
par promotion — le filtre se fait chez nous, par les appartements).

Rattacher : immeubles → biens (par nom), appartements → lots (par `kolabimoAppartementId`, à défaut
par référence), parkings par référence (l'API ne donne pas leur id), étapes par `kolabimoEtapeId`
— une étape Prometis sans id au même rang est **adoptée**. Un rang occupé par une étape absente de
Kolabimo **refuse l'échéancier entier** avant toute écriture, lots et réservations passent quand
même. Pourcentage 0 chez Kolabimo → jalon de suivi (nul) chez nous. Pourcentage figé si des appels
en découlent. **Aucun appel de fonds** n'est émis par une synchronisation.
