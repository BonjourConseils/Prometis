# RLS — isolation multi-tenant en base

## Le problème du schéma

`schema.prisma` ne met `societe_id` que sur **12 tables sur 40**. Les 28 autres sont rattachées
au tenant par une chaîne de clés étrangères. Le schéma étant source de vérité, on ne dénormalise
pas `societe_id` partout : on écrit des policies qui remontent la chaîne.

## Helpers SQL

Migration `.../migration.sql` (schéma `app`) :

```sql
CREATE SCHEMA IF NOT EXISTS app;

-- Tenant courant. NULL si non posé → toutes les policies refusent (deny by default).
CREATE FUNCTION app.current_societe_id() RETURNS integer
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.societe_id', true), '')::integer $$;

CREATE FUNCTION app.is_tenant_operation(op_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.operations o
                 WHERE o.id = op_id AND o.societe_id = app.current_societe_id()) $$;
```

Puis, en cascade : `is_tenant_bien`, `is_tenant_lot`, `is_tenant_soumission`, `is_tenant_contrat`,
`is_tenant_facture`, `is_tenant_reservation`, `is_tenant_budget_version`, `is_tenant_seance`,
`is_tenant_mandat_courtage`, `is_tenant_appel_de_fonds`. Chacune s'appuie sur la précédente.

Les fonctions ne sont **pas** `SECURITY DEFINER` : elles s'exécutent avec les droits de l'appelant,
donc la RLS de la table parente s'applique aussi. Double filet.

## Chemin tenant des 40 tables

### Direct — `societe_id = app.current_societe_id()` (11 tables)

`memberships` · `actionnaires` · `api_keys` · `operations` · `acteurs` · `entreprises` ·
`acquereurs` · `factures` · `documents` · `audit_logs` · `seances`

### Le tenant lui-même

`societes` → `USING (id = app.current_societe_id())`

### Via `operation_id` — `app.is_tenant_operation(operation_id)` (12 tables)

`operation_acteurs` · `biens` · `cfc_nodes` · `budget_versions` · `soumissions` · `contrats` ·
`reservations` · `echeancier_etapes` · `parcelles` · `ppes` · `mandats_courtage` ·
`operation_accesses`

### Via un parent plus profond (14 tables)

| Table | Prédicat |
|---|---|
| `lots` | `app.is_tenant_bien(bien_id)` |
| `parkings` | `app.is_tenant_lot(lot_id)` |
| `lignes_budget` | `app.is_tenant_budget_version(budget_version_id)` |
| `soumission_invitations` | `app.is_tenant_soumission(soumission_id)` |
| `offres` | `app.is_tenant_soumission(soumission_id)` |
| `adjudications` | `app.is_tenant_soumission(soumission_id)` |
| `avenants` | `app.is_tenant_contrat(contrat_id)` |
| `paiements_fournisseurs` | `app.is_tenant_facture(facture_id)` |
| `appels_de_fonds` | `app.is_tenant_reservation(reservation_id)` |
| `encaissements` | `app.is_tenant_appel_de_fonds(appel_de_fonds_id)` |
| `seance_participants` | `app.is_tenant_seance(seance_id)` |
| `seance_points` | `app.is_tenant_seance(seance_id)` |
| `mandat_courtage_lots` | `app.is_tenant_mandat_courtage(mandat_courtage_id)` |
| `commissions_courtage` | `app.is_tenant_mandat_courtage(mandat_courtage_id)` |

### Exemptions assumées (3)

| Table | Pourquoi |
|---|---|
| `comptes` | identité globale — lue au login, avant qu'un tenant soit connu. La table ne contient aucune donnée métier, et rien n'en sort sans mot de passe valide. |
| `webhook_events` | journal d'ingestion brut, écrit avant résolution du tenant. Le payload est routé vers un tenant au traitement. |
| `_prisma_migrations` | table technique Prisma. |

Toute autre table sans policy = fuite. Le test d'inventaire dans `tests/rls-isolation.spec.ts`
compare `pg_tables` à `pg_policies` et échoue sur toute table non couverte et non exemptée.

## Forme d'une policy

```sql
ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.lots
  USING (app.is_tenant_bien(bien_id))
  WITH CHECK (app.is_tenant_bien(bien_id));
```

`USING` filtre la lecture (et le ciblage d'`UPDATE`/`DELETE`), `WITH CHECK` empêche d'écrire une
ligne rattachée à un autre tenant. **Toujours les deux.**

## Pourquoi pas `FORCE ROW LEVEL SECURITY`

`FORCE` soumettrait aussi le rôle owner aux policies. Or le seed doit créer une `Societe` avant de
connaître son id — le `WITH CHECK` sur `societes` échouerait. On garde donc :
owner = migrations/seed (bypass), `prometis_app` = application (soumise). C'est la séparation de
rôles qui porte la sécurité, pas `FORCE`.

## Droits de `prometis_app`

Dans la migration RLS, exécutée par l'owner :

```sql
GRANT USAGE ON SCHEMA public, app TO prometis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prometis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prometis_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO prometis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prometis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prometis_app;
```

`prometis_app` n'a **aucun** droit DDL : une migration ne peut pas partir du runtime applicatif.

## Le trou assumé : le pré-tenant

Certaines questions doivent trouver réponse **avant** qu'un tenant soit choisi. La principale :
« à quelles sociétés ce compte appartient-il ? », posée par le sélecteur d'espace de travail. La
policy de `memberships` exige déjà `app.societe_id` — l'oeuf et la poule.

Deux fonctions `SECURITY DEFINER` répondent, en contournant la RLS de façon strictement bornée :

| Fonction | Répond à | Portée |
|---|---|---|
| `app.memberships_du_compte(compte_id)` | espaces de travail d'un compte | un seul compte, aucun secret renvoyé |
| `app.membership_actif(compte_id, societe_id)` | ce compte peut-il entrer ici ? | un couple compte/société |

Précautions obligatoires, à reproduire pour toute nouvelle fonction de ce type :

- `SET search_path = pg_catalog, public` — sinon un schéma malveillant en tête de chemin peut
  détourner les références de tables.
- aucun paramètre interpolé dans du SQL dynamique ;
- surface minimale : ne renvoyer que ce dont l'appelant a besoin ;
- `REVOKE EXECUTE … FROM PUBLIC` puis `GRANT` au seul rôle applicatif ;
- inscription dans `app.security_definer_autorisees` avec la raison — c'est l'inventaire qu'une
  revue de sécurité relit.

Ces fonctions **ne vérifient pas l'identité** : elles répondent à une question sur un id.
L'appelant doit avoir authentifié le compte avant.

## Poser le contexte depuis l'app

`SET LOCAL` n'existe que dans une transaction. D'où `TenantPrismaService.runInTenant()` qui ouvre
une transaction interactive Prisma, exécute `SET LOCAL app.societe_id`, puis passe le `tx` au
callback. L'id est injecté en paramètre lié (`$executeRaw`), jamais concaténé — le paramètre
vient d'un JWT, mais on ne fait pas d'exception à la règle.

Coût : chaque requête tenant = une transaction. Acceptable, et c'est le prix de l'isolation en base.
Une connexion réutilisée sans `SET LOCAL` verrait `NULL` → 0 ligne, jamais les données d'un autre.
