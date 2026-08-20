-- CreateEnum
CREATE TYPE "ParcelleDecoupageType" AS ENUM ('ZONE_AFFECTATION', 'DEGRE_SENSIBILITE_BRUIT', 'AUTRE');

-- CreateTable
CREATE TABLE "parcelle_decoupages" (
    "id" SERIAL NOT NULL,
    "parcelle_id" INTEGER NOT NULL,
    "type" "ParcelleDecoupageType" NOT NULL,
    "libelle" TEXT NOT NULL,
    "surface_m2" DECIMAL(12,2),
    "pourcentage" DECIMAL(6,2),
    "ibus" DECIMAL(6,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcelle_decoupages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcelle_decoupages_parcelle_id_idx" ON "parcelle_decoupages"("parcelle_id");

-- AddForeignKey
ALTER TABLE "parcelle_decoupages" ADD CONSTRAINT "parcelle_decoupages_parcelle_id_fkey" FOREIGN KEY ("parcelle_id") REFERENCES "parcelles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
--  Isolation multi-tenant
--
--  `parcelle_decoupages` ne porte pas de `societe_id` : son rattachement
--  passe par la parcelle, puis l'opération. Sans policy, la table serait le
--  seul endroit de la base où une découpe de parcelle traverserait les
--  sociétés — l'exception qu'on ne veut pas.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.is_tenant_parcelle(p_parcelle_id integer) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.parcelles p
      WHERE p.id = p_parcelle_id AND app.is_tenant_operation(p.operation_id)
    )
  $$;

ALTER TABLE public.parcelle_decoupages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.parcelle_decoupages
  USING (app.is_tenant_parcelle(parcelle_id))
  WITH CHECK (app.is_tenant_parcelle(parcelle_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parcelle_decoupages TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.parcelle_decoupages_id_seq TO prometis_app;
