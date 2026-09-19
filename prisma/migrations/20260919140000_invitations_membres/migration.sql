-- =====================================================================
--  Équipe : inviter un employé, un architecte, une direction des travaux
-- =====================================================================

-- AlterEnum
ALTER TYPE "ActeurType" ADD VALUE 'DIRECTION_TRAVAUX';

-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "direction_travaux_id" INTEGER;

-- CreateTable
CREATE TABLE "invitations_membres" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "prenom" TEXT,
    "nom" TEXT,
    "role" "UtilisateurRole" NOT NULL,
    "fonction" TEXT,
    "acteur_type" "ActeurType",
    "societe_nom" TEXT,
    "acces" JSONB NOT NULL DEFAULT '[]',
    "direction_travaux_de" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "token_hash" TEXT NOT NULL,
    "expire_le" TIMESTAMP(3) NOT NULL,
    "acceptee_le" TIMESTAMP(3),
    "revoquee_le" TIMESTAMP(3),
    "compte_id" INTEGER,
    "cree_par_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_membres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_membres_token_hash_key" ON "invitations_membres"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_membres_societe_id_acceptee_le_idx" ON "invitations_membres"("societe_id", "acceptee_le");

-- AddForeignKey
ALTER TABLE "invitations_membres" ADD CONSTRAINT "invitations_membres_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_direction_travaux_id_fkey" FOREIGN KEY ("direction_travaux_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Une invitation appartient à la société qui invite.
ALTER TABLE public.invitations_membres ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.invitations_membres
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT, UPDATE ON public.invitations_membres TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.invitations_membres_id_seq TO prometis_app;

-- =====================================================================
--  Accepter une invitation se fait sans session : la personne n'a pas
--  encore de place dans la société. La fonction rend l'invitation et sa
--  société à partir de l'empreinte du lien — rien d'autre ; l'acceptation se
--  poursuit dans le tenant, sous RLS.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.invitation_membre_de_jeton(p_hash text)
  RETURNS TABLE (invitation_id integer, societe_id integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.societe_id FROM public.invitations_membres i WHERE i.token_hash = p_hash
  $$;

REVOKE EXECUTE ON FUNCTION app.invitation_membre_de_jeton(text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.invitation_membre_de_jeton(text) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('invitation_membre_de_jeton', 'Accepter une invitation à rejoindre une société : retrouve l''invitation par l''empreinte de son lien. Rend deux identifiants ; l''acceptation se fait dans le tenant.')
ON CONFLICT (nom_fonction) DO NOTHING;
