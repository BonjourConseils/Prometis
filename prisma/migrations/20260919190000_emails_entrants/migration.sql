-- =====================================================================
--  Réception des factures par e-mail — une adresse par promotion
-- =====================================================================

-- AlterTable
ALTER TABLE "operations" ADD COLUMN     "boite_factures_jeton" TEXT,
ADD COLUMN     "boite_factures_ouverte" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "emails_entrants" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "message_id" TEXT NOT NULL,
    "expediteur" TEXT NOT NULL,
    "sujet" TEXT,
    "recu_le" TIMESTAMP(3) NOT NULL,
    "statut" TEXT NOT NULL,
    "motif" TEXT,
    "authentification" TEXT,
    "brut_cle" TEXT,
    "pieces" INTEGER NOT NULL DEFAULT 0,
    "pieces_acceptees" INTEGER NOT NULL DEFAULT 0,
    "traite_le" TIMESTAMP(3),
    "traite_par_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_entrants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emails_entrants_operation_id_created_at_idx" ON "emails_entrants"("operation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "emails_entrants_societe_id_message_id_key" ON "emails_entrants"("societe_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "operations_boite_factures_jeton_key" ON "operations"("boite_factures_jeton");

-- AddForeignKey
ALTER TABLE "emails_entrants" ADD CONSTRAINT "emails_entrants_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails_entrants" ADD CONSTRAINT "emails_entrants_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE public.emails_entrants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.emails_entrants
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT, UPDATE ON public.emails_entrants TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.emails_entrants_id_seq TO prometis_app;

-- =====================================================================
--  Un message arrive sans session : on ne connaît que le jeton de
--  l'adresse. La fonction rend la promotion et sa société — rien d'autre ;
--  le traitement se poursuit dans le tenant.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.operation_de_boite_factures(p_jeton text)
  RETURNS TABLE (operation_id integer, societe_id integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT o.id, o.societe_id FROM public.operations o WHERE o.boite_factures_jeton = p_jeton
  $$;

REVOKE EXECUTE ON FUNCTION app.operation_de_boite_factures(text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.operation_de_boite_factures(text) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('operation_de_boite_factures', 'Réception des factures par e-mail : retrouve la promotion d''une adresse par son jeton. Rend deux identifiants ; le message est traité dans le tenant.')
ON CONFLICT (nom_fonction) DO NOTHING;
