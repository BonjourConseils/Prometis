-- =====================================================================
--  Lot 1 — identité et accès : le problème du « pré-tenant »
--
--  Le sélecteur d'espace de travail doit répondre à « à quelles sociétés
--  ce compte appartient-il ? » AVANT qu'un tenant soit choisi. Or la policy
--  de `memberships` exige déjà `app.societe_id` : sans tenant, elle renvoie
--  zéro ligne. C'est l'oeuf et la poule, par construction.
--
--  Solution : deux fonctions SECURITY DEFINER, donc exécutées avec les
--  droits du PROPRIÉTAIRE, qui contournent la RLS — mais strictement
--  scopées à UN compte passé en paramètre. Elles ne peuvent rien révéler
--  d'autre que la liste des espaces de ce compte.
--
--  Précautions obligatoires sur du SECURITY DEFINER :
--    · `SET search_path` figé — sinon un schéma malveillant en tête de
--      chemin pourrait détourner les références de tables.
--    · aucun paramètre interpolé dans du SQL dynamique.
--    · surface minimale : ces fonctions ne renvoient QUE ce dont le
--      sélecteur a besoin, jamais le hash du mot de passe.
--
--  L'appelant doit avoir authentifié le compte avant d'appeler. La fonction
--  ne vérifie pas l'identité : elle répond à une question sur un id.
-- =====================================================================

-- Espaces de travail d'un compte : une ligne par société où il est membre actif.
CREATE OR REPLACE FUNCTION app.memberships_du_compte(p_compte_id integer)
  RETURNS TABLE (
    membership_id   integer,
    societe_id      integer,
    role            "UtilisateurRole",
    fonction        text,
    acteur_id       integer,
    raison_sociale  text,
    profil          "SocieteProfil",
    modules_actifs  "AppModule"[]
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT m.id, s.id, m.role, m.fonction, m.acteur_id,
           s.raison_sociale, s.profil, s.modules_actifs
    FROM public.memberships m
    JOIN public.societes s ON s.id = m.societe_id
    WHERE m.compte_id = p_compte_id
      AND m.is_active IS TRUE
    ORDER BY s.raison_sociale
  $$;

-- Ce compte peut-il entrer dans cet espace ? Appelée au choix d'espace de
-- travail, avant que le contexte tenant existe.
CREATE OR REPLACE FUNCTION app.membership_actif(p_compte_id integer, p_societe_id integer)
  RETURNS TABLE (membership_id integer, role "UtilisateurRole")
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT m.id, m.role
    FROM public.memberships m
    WHERE m.compte_id = p_compte_id
      AND m.societe_id = p_societe_id
      AND m.is_active IS TRUE
  $$;

-- Les fonctions SECURITY DEFINER sont exécutables par PUBLIC par défaut :
-- on restreint explicitement au rôle applicatif.
REVOKE EXECUTE ON FUNCTION app.memberships_du_compte(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.membership_actif(integer, integer) FROM PUBLIC;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.memberships_du_compte(integer) TO prometis_app;
    GRANT EXECUTE ON FUNCTION app.membership_actif(integer, integer) TO prometis_app;
  END IF;
END
$do$;

-- Inventaire des fonctions qui contournent la RLS, pour que le test de
-- sécurité échoue si une nouvelle apparaît sans être passée en revue.
CREATE TABLE app.security_definer_autorisees (
  nom_fonction text PRIMARY KEY,
  raison       text NOT NULL
);

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('memberships_du_compte', 'Sélecteur d''espace de travail : liste les sociétés d''UN compte avant qu''un tenant soit choisi. Scopée au compte, ne renvoie aucun secret.'),
  ('membership_actif', 'Vérifie qu''un compte peut entrer dans une société donnée, au moment du choix d''espace.');

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT SELECT ON app.security_definer_autorisees TO prometis_app;
  END IF;
END
$do$;

-- Le login cherche un compte par e-mail : index déjà fourni par @unique.
-- La recherche des memberships d'un compte, elle, n'était pas indexée.
CREATE INDEX IF NOT EXISTS memberships_compte_id_idx ON public.memberships (compte_id);
