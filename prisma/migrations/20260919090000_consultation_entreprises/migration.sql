-- =====================================================================
--  Appels d'offres : registre enrichi et consultation des entreprises
-- =====================================================================

-- CreateEnum
CREATE TYPE "OffreLigneType" AS ENUM ('OPTION', 'VARIANTE');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "offre_id" INTEGER;

-- AlterTable
ALTER TABLE "offres" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SAISIE';

-- AlterTable
ALTER TABLE "soumission_invitations" ADD COLUMN     "code_essais" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "code_expire_le" TIMESTAMP(3),
ADD COLUMN     "code_hash" TEXT,
ADD COLUMN     "consultee_le" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "jeton_hash" TEXT,
ADD COLUMN     "motif_refus" TEXT,
ADD COLUMN     "refuse_le" TIMESTAMP(3),
ADD COLUMN     "relance_le" TIMESTAMP(3),
ADD COLUMN     "revoquee_le" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "soumissions" ADD COLUMN     "conditions" TEXT,
ADD COLUMN     "delai_execution" TEXT,
ADD COLUMN     "descriptif" TEXT,
ADD COLUMN     "offres_scellees" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "offre_lignes" (
    "id" SERIAL NOT NULL,
    "offre_id" INTEGER NOT NULL,
    "type" "OffreLigneType" NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "retenue" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offre_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criteres_soumission" (
    "id" SERIAL NOT NULL,
    "soumission_id" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "poids" DECIMAL(5,2) NOT NULL,
    "est_prix" BOOLEAN NOT NULL DEFAULT false,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "criteres_soumission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes_offres" (
    "id" SERIAL NOT NULL,
    "offre_id" INTEGER NOT NULL,
    "critere_id" INTEGER NOT NULL,
    "note" DECIMAL(4,2) NOT NULL,
    "commentaire" TEXT,
    "note_par_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_offres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions_soumission" (
    "id" SERIAL NOT NULL,
    "soumission_id" INTEGER NOT NULL,
    "invitation_id" INTEGER,
    "question" TEXT NOT NULL,
    "reponse" TEXT,
    "repondu_le" TIMESTAMP(3),
    "publiee" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_soumission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offre_lignes_offre_id_idx" ON "offre_lignes"("offre_id");

-- CreateIndex
CREATE INDEX "criteres_soumission_soumission_id_idx" ON "criteres_soumission"("soumission_id");

-- CreateIndex
CREATE UNIQUE INDEX "notes_offres_offre_id_critere_id_key" ON "notes_offres"("offre_id", "critere_id");

-- CreateIndex
CREATE INDEX "questions_soumission_soumission_id_idx" ON "questions_soumission"("soumission_id");

-- CreateIndex
CREATE UNIQUE INDEX "soumission_invitations_jeton_hash_key" ON "soumission_invitations"("jeton_hash");

-- AddForeignKey
ALTER TABLE "offre_lignes" ADD CONSTRAINT "offre_lignes_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criteres_soumission" ADD CONSTRAINT "criteres_soumission_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes_offres" ADD CONSTRAINT "notes_offres_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes_offres" ADD CONSTRAINT "notes_offres_critere_id_fkey" FOREIGN KEY ("critere_id") REFERENCES "criteres_soumission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions_soumission" ADD CONSTRAINT "questions_soumission_soumission_id_fkey" FOREIGN KEY ("soumission_id") REFERENCES "soumissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions_soumission" ADD CONSTRAINT "questions_soumission_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "soumission_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_offre_id_fkey" FOREIGN KEY ("offre_id") REFERENCES "offres"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
--  Isolation : chaque nouvelle table rejoint son tenant par la soumission.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.is_tenant_offre(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.offres o
      WHERE o.id = p_id AND app.is_tenant_soumission(o.soumission_id)
    )
  $$;

ALTER TABLE public.offre_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.offre_lignes
  USING (app.is_tenant_offre(offre_id))
  WITH CHECK (app.is_tenant_offre(offre_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offre_lignes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.offre_lignes_id_seq TO prometis_app;

ALTER TABLE public.notes_offres ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.notes_offres
  USING (app.is_tenant_offre(offre_id))
  WITH CHECK (app.is_tenant_offre(offre_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes_offres TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.notes_offres_id_seq TO prometis_app;

ALTER TABLE public.criteres_soumission ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.criteres_soumission
  USING (app.is_tenant_soumission(soumission_id))
  WITH CHECK (app.is_tenant_soumission(soumission_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.criteres_soumission TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.criteres_soumission_id_seq TO prometis_app;

ALTER TABLE public.questions_soumission ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.questions_soumission
  USING (app.is_tenant_soumission(soumission_id))
  WITH CHECK (app.is_tenant_soumission(soumission_id));
GRANT SELECT, INSERT, UPDATE ON public.questions_soumission TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.questions_soumission_id_seq TO prometis_app;

-- =====================================================================
--  L'espace entreprise n'a pas de session Prometis.
--
--  Il ne connaît que l'empreinte de son lien. La fonction rend l'invitation,
--  sa soumission et la société — rien d'autre ; la suite se déroule DANS le
--  tenant, sous RLS, bornée à cette seule invitation par le code.
--
--  La passe quotidienne cherche, toutes sociétés confondues, les invitations
--  sans réponse dont la date limite approche : identifiants seulement.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.invitation_de_jeton(p_hash text)
  RETURNS TABLE (invitation_id integer, soumission_id integer, societe_id integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.soumission_id, o.societe_id
    FROM public.soumission_invitations i
    JOIN public.soumissions s ON s.id = i.soumission_id
    JOIN public.operations o ON o.id = s.operation_id
    WHERE i.jeton_hash = p_hash
  $$;

CREATE OR REPLACE FUNCTION app.invitations_a_relancer(p_jusqua timestamp)
  RETURNS TABLE (invitation_id integer, societe_id integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, o.societe_id
    FROM public.soumission_invitations i
    JOIN public.soumissions s ON s.id = i.soumission_id
    JOIN public.operations o ON o.id = s.operation_id
    WHERE s.statut IN ('ENVOYEE', 'OUVERTE')
      AND s.date_limite IS NOT NULL
      AND s.date_limite > now()
      AND s.date_limite <= p_jusqua
      AND i.jeton_hash IS NOT NULL
      AND i.revoquee_le IS NULL
      AND i.refuse_le IS NULL
      AND i.relance_le IS NULL
      AND NOT i.a_repondu
  $$;

REVOKE EXECUTE ON FUNCTION app.invitation_de_jeton(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.invitations_a_relancer(timestamp) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.invitation_de_jeton(text) TO prometis_app;
    GRANT EXECUTE ON FUNCTION app.invitations_a_relancer(timestamp) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('invitation_de_jeton', 'Espace entreprise : retrouve une invitation par l''empreinte de son lien. Rend trois identifiants ; le reste se lit dans le tenant, borné à cette invitation.'),
  ('invitations_a_relancer', 'Passe quotidienne : invitations sans réponse dont la date limite approche (identifiants seulement), pour la relance unique.')
ON CONFLICT (nom_fonction) DO NOTHING;

-- Une soumission existante ne change pas de régime : ses offres ont été
-- saisies par le promoteur, rien n'est scellé.
UPDATE public.soumissions SET offres_scellees = false;
