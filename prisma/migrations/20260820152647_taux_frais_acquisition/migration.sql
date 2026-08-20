-- CreateTable
CREATE TABLE "taux_frais_acquisition" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "canton" VARCHAR(2) NOT NULL,
    "pourcentage" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taux_frais_acquisition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taux_frais_acquisition_societe_id_idx" ON "taux_frais_acquisition"("societe_id");

-- CreateIndex
CREATE UNIQUE INDEX "taux_frais_acquisition_societe_id_canton_key" ON "taux_frais_acquisition"("societe_id", "canton");

-- AddForeignKey
ALTER TABLE "taux_frais_acquisition" ADD CONSTRAINT "taux_frais_acquisition_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
--  Isolation multi-tenant
-- =====================================================================

ALTER TABLE public.taux_frais_acquisition ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.taux_frais_acquisition
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.taux_frais_acquisition TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.taux_frais_acquisition_id_seq TO prometis_app;
