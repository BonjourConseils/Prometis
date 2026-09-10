-- =====================================================================
--  Connexion Kolabimo par société
--
--  Jusqu'ici l'URL et la clé Kolabimo étaient des variables d'environnement,
--  donc globales à l'instance : deux promoteurs sur Prometis auraient parlé à
--  Kolabimo avec la même clé. Depuis SEC1 (Kolabimo 1.3.0, 4 septembre 2026),
--  une clé est cloisonnée à UN promoteur — la connexion devient une donnée du
--  tenant.
-- =====================================================================

CREATE TABLE "connexions_kolabimo" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "base_url" TEXT NOT NULL DEFAULT 'https://kolabimo.ch',
    "cle_api_chiffree" TEXT,
    "cle_api_apercu" TEXT,
    "jeton_webhook" TEXT NOT NULL,
    "secret_webhook_chiffre" TEXT NOT NULL,
    "promoteur_kolabimo_id" INTEGER,
    "promoteur_kolabimo_nom" TEXT,
    "verifiee_le" TIMESTAMP(3),
    "derniere_erreur" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connexions_kolabimo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connexions_kolabimo_societe_id_key" ON "connexions_kolabimo"("societe_id");
CREATE UNIQUE INDEX "connexions_kolabimo_jeton_webhook_key" ON "connexions_kolabimo"("jeton_webhook");

ALTER TABLE "connexions_kolabimo" ADD CONSTRAINT "connexions_kolabimo_societe_id_fkey"
  FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
--  Isolation multi-tenant — la table porte `societe_id`.
-- =====================================================================

ALTER TABLE public.connexions_kolabimo ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.connexions_kolabimo
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.connexions_kolabimo TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.connexions_kolabimo_id_seq TO prometis_app;

-- =====================================================================
--  Le webhook arrive avant qu'un tenant existe
--
--  Kolabimo n'envoie pas de clé d'API avec ses webhooks : il signe, et c'est
--  tout. Le tenant se lit donc dans l'URL, par le jeton. Mais la table est
--  sous RLS, et le tenant est justement ce qu'on cherche — même motif que
--  `societe_de_cle_api` au Lot 7. Scopée à un jeton, elle ne rend que la
--  société et le secret chiffré ; déchiffrer exige encore la clé hors base.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.societe_de_jeton_kolabimo(p_jeton text)
  RETURNS TABLE (societe_id integer, secret_webhook_chiffre text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT c.societe_id, c.secret_webhook_chiffre
    FROM public.connexions_kolabimo c
    WHERE c.jeton_webhook = p_jeton
  $$;

REVOKE EXECUTE ON FUNCTION app.societe_de_jeton_kolabimo(text) FROM PUBLIC;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.societe_de_jeton_kolabimo(text) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('societe_de_jeton_kolabimo', 'Passerelle Kolabimo : résout le tenant d''un webhook entrant depuis le jeton de son URL — Kolabimo n''envoie pas de clé d''API, il signe. Scopée à un jeton ; rend le secret CHIFFRÉ, inutilisable sans la clé hors base.')
ON CONFLICT (nom_fonction) DO NOTHING;
