-- =====================================================================
--  Isolation multi-tenant par Row-Level Security PostgreSQL
--
--  Le schéma ne porte `societe_id` que sur 11 tables sur 40 ; les 26 autres
--  sont rattachées au tenant par une chaîne de clés étrangères. Plutôt que
--  de dénormaliser `societe_id` partout (donnée redondante à maintenir
--  cohérente à chaque écriture, donc nouveau risque de fuite), on résout la
--  chaîne avec des fonctions SQL en cascade.
--
--  Deux rôles :
--    · prometis      (owner) — migrations et seed. Contourne la RLS.
--    · prometis_app          — l'application. NOBYPASSRLS, aucun droit DDL.
--
--  Refus par défaut : si `app.societe_id` n'est pas posé sur la transaction,
--  app.current_societe_id() vaut NULL et TOUTES les policies renvoient zéro
--  ligne. Un oubli casse la fonctionnalité, il ne fuit jamais.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------
--  Fonctions de résolution du tenant
-- ---------------------------------------------------------------------

-- Tenant courant de la transaction. NULL si non posé.
CREATE OR REPLACE FUNCTION app.current_societe_id() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.societe_id', true), '')::integer $$;

CREATE OR REPLACE FUNCTION app.is_tenant_operation(op_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.operations o
      WHERE o.id = op_id AND o.societe_id = app.current_societe_id()
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_bien(p_bien_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.biens b
      WHERE b.id = p_bien_id AND app.is_tenant_operation(b.operation_id)
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_lot(p_lot_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.lots l
      WHERE l.id = p_lot_id AND app.is_tenant_bien(l.bien_id)
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_budget_version(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.budget_versions v
      WHERE v.id = p_id AND app.is_tenant_operation(v.operation_id)
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_soumission(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.soumissions s
      WHERE s.id = p_id AND app.is_tenant_operation(s.operation_id)
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_contrat(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.contrats c
      WHERE c.id = p_id AND app.is_tenant_operation(c.operation_id)
    )
  $$;

-- `factures` porte directement societe_id.
CREATE OR REPLACE FUNCTION app.is_tenant_facture(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.factures f
      WHERE f.id = p_id AND f.societe_id = app.current_societe_id()
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_reservation(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = p_id AND app.is_tenant_operation(r.operation_id)
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_appel_de_fonds(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.appels_de_fonds a
      WHERE a.id = p_id AND app.is_tenant_reservation(a.reservation_id)
    )
  $$;

-- `seances` porte directement societe_id.
CREATE OR REPLACE FUNCTION app.is_tenant_seance(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.seances s
      WHERE s.id = p_id AND s.societe_id = app.current_societe_id()
    )
  $$;

CREATE OR REPLACE FUNCTION app.is_tenant_mandat_courtage(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.mandats_courtage m
      WHERE m.id = p_id AND app.is_tenant_operation(m.operation_id)
    )
  $$;

-- =====================================================================
--  1. Le tenant lui-même
-- =====================================================================

ALTER TABLE public.societes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.societes
  USING (id = app.current_societe_id())
  WITH CHECK (id = app.current_societe_id());

-- =====================================================================
--  2. Tables portant societe_id (11)
--
--  Note pour le Lot 1 : le sélecteur d'espace de travail doit lister les
--  `memberships` d'un compte AVANT qu'un tenant soit choisi. Cette requête
--  ne peut donc pas passer par le contexte tenant — elle nécessitera une
--  fonction SECURITY DEFINER dédiée, scopée au compte authentifié.
-- =====================================================================

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.memberships
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.actionnaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.actionnaires
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.api_keys
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.operations
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.acteurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.acteurs
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.entreprises ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.entreprises
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.acquereurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.acquereurs
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.factures
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.documents
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.audit_logs
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

ALTER TABLE public.seances ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.seances
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

-- =====================================================================
--  3. Tables rattachées par operation_id (12)
-- =====================================================================

ALTER TABLE public.operation_acteurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.operation_acteurs
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.biens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.biens
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.cfc_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.cfc_nodes
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.budget_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.budget_versions
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.soumissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.soumissions
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.contrats ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.contrats
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.reservations
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.echeancier_etapes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.echeancier_etapes
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.parcelles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.parcelles
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.ppes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.ppes
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.mandats_courtage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mandats_courtage
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

ALTER TABLE public.operation_accesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.operation_accesses
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));

-- =====================================================================
--  4. Tables rattachées par un parent plus profond (14)
-- =====================================================================

ALTER TABLE public.lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.lots
  USING (app.is_tenant_bien(bien_id))
  WITH CHECK (app.is_tenant_bien(bien_id));

ALTER TABLE public.parkings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.parkings
  USING (app.is_tenant_lot(lot_id))
  WITH CHECK (app.is_tenant_lot(lot_id));

ALTER TABLE public.lignes_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.lignes_budget
  USING (app.is_tenant_budget_version(budget_version_id))
  WITH CHECK (app.is_tenant_budget_version(budget_version_id));

ALTER TABLE public.soumission_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.soumission_invitations
  USING (app.is_tenant_soumission(soumission_id))
  WITH CHECK (app.is_tenant_soumission(soumission_id));

ALTER TABLE public.offres ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.offres
  USING (app.is_tenant_soumission(soumission_id))
  WITH CHECK (app.is_tenant_soumission(soumission_id));

ALTER TABLE public.adjudications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.adjudications
  USING (app.is_tenant_soumission(soumission_id))
  WITH CHECK (app.is_tenant_soumission(soumission_id));

ALTER TABLE public.avenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.avenants
  USING (app.is_tenant_contrat(contrat_id))
  WITH CHECK (app.is_tenant_contrat(contrat_id));

ALTER TABLE public.paiements_fournisseurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.paiements_fournisseurs
  USING (app.is_tenant_facture(facture_id))
  WITH CHECK (app.is_tenant_facture(facture_id));

ALTER TABLE public.appels_de_fonds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.appels_de_fonds
  USING (app.is_tenant_reservation(reservation_id))
  WITH CHECK (app.is_tenant_reservation(reservation_id));

ALTER TABLE public.encaissements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.encaissements
  USING (app.is_tenant_appel_de_fonds(appel_de_fonds_id))
  WITH CHECK (app.is_tenant_appel_de_fonds(appel_de_fonds_id));

ALTER TABLE public.seance_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.seance_participants
  USING (app.is_tenant_seance(seance_id))
  WITH CHECK (app.is_tenant_seance(seance_id));

ALTER TABLE public.seance_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.seance_points
  USING (app.is_tenant_seance(seance_id))
  WITH CHECK (app.is_tenant_seance(seance_id));

ALTER TABLE public.mandat_courtage_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.mandat_courtage_lots
  USING (app.is_tenant_mandat_courtage(mandat_courtage_id))
  WITH CHECK (app.is_tenant_mandat_courtage(mandat_courtage_id));

ALTER TABLE public.commissions_courtage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.commissions_courtage
  USING (app.is_tenant_mandat_courtage(mandat_courtage_id))
  WITH CHECK (app.is_tenant_mandat_courtage(mandat_courtage_id));

-- =====================================================================
--  5. Exemptions ASSUMÉES — inscrites en base pour que le test
--     d'inventaire les distingue d'un oubli.
--
--     · comptes        identité globale, lue au login avant qu'un tenant
--                      soit connu. Protégée applicativement : on ne renvoie
--                      jamais un Compte sans passer par un Membership.
--     · webhook_events journal d'ingestion brut, écrit avant résolution du
--                      tenant ; le payload est routé au traitement.
-- =====================================================================

CREATE TABLE app.rls_exemptions (
  table_name text PRIMARY KEY,
  raison     text NOT NULL
);

INSERT INTO app.rls_exemptions (table_name, raison) VALUES
  ('comptes', 'Identité globale : lue au login, avant qu''un tenant soit connu. Protégée applicativement via Membership.'),
  ('webhook_events', 'Journal d''ingestion brut : écrit avant résolution du tenant, routé au traitement.'),
  ('_prisma_migrations', 'Table technique Prisma.');

-- =====================================================================
--  6. Droits du rôle applicatif
--
--  Aucun droit DDL : une migration ne peut pas partir du runtime.
-- =====================================================================

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT USAGE ON SCHEMA public TO prometis_app;
    GRANT USAGE ON SCHEMA app TO prometis_app;

    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prometis_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prometis_app;
    GRANT SELECT ON app.rls_exemptions TO prometis_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO prometis_app;

    -- Les tables des lots suivants héritent automatiquement de ces droits.
    -- Elles n'héritent PAS d'une policy : c'est à la migration de la poser.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prometis_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO prometis_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app
      GRANT EXECUTE ON FUNCTIONS TO prometis_app;
  END IF;
END
$do$;
