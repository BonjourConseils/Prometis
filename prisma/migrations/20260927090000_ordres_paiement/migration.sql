-- =====================================================================
--  Ordres de paiement : le lot de factures qui part à la banque
-- =====================================================================
--
-- « Un compte par promotion, et je vise l'ordre » (CB Promotions,
-- 25.09.2026). Le compte débiteur est celui de la promotion — en principe
-- son crédit de construction. L'ordre fige ce qui partira : montants,
-- comptes des créanciers, références. Une facture corrigée après coup ne
-- réécrit donc pas un ordre déjà visé.

-- CreateEnum
CREATE TYPE "OrdrePaiementStatut" AS ENUM ('BROUILLON', 'VISE', 'TRANSMIS', 'ANNULE');

-- AlterTable
ALTER TABLE "operations"
  ADD COLUMN "iban_paiement" TEXT,
  ADD COLUMN "bic_paiement" TEXT;

-- CreateTable
CREATE TABLE "ordres_paiement" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "libelle" TEXT,
    "statut" "OrdrePaiementStatut" NOT NULL DEFAULT 'BROUILLON',
    "date_execution" TIMESTAMP(3),
    "iban_debiteur" TEXT NOT NULL,
    "bic_debiteur" TEXT,
    "cree_par_id" INTEGER,
    "vise_par_id" INTEGER,
    "vise_le" TIMESTAMP(3),
    "transmis_le" TIMESTAMP(3),
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ordres_paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lignes_ordre_paiement" (
    "id" SERIAL NOT NULL,
    "ordre_id" INTEGER NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "creancier_nom" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "reference" TEXT,
    "communication" TEXT,

    CONSTRAINT "lignes_ordre_paiement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ordres_paiement_message_id_key" ON "ordres_paiement"("message_id");
CREATE UNIQUE INDEX "ordres_paiement_operation_id_numero_key" ON "ordres_paiement"("operation_id", "numero");
CREATE INDEX "ordres_paiement_societe_id_idx" ON "ordres_paiement"("societe_id");
CREATE INDEX "ordres_paiement_operation_id_idx" ON "ordres_paiement"("operation_id");
CREATE UNIQUE INDEX "lignes_ordre_paiement_ordre_id_facture_id_key" ON "lignes_ordre_paiement"("ordre_id", "facture_id");
CREATE INDEX "lignes_ordre_paiement_facture_id_idx" ON "lignes_ordre_paiement"("facture_id");

-- AddForeignKey
ALTER TABLE "ordres_paiement" ADD CONSTRAINT "ordres_paiement_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ordres_paiement" ADD CONSTRAINT "ordres_paiement_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ordres_paiement" ADD CONSTRAINT "ordres_paiement_cree_par_id_fkey" FOREIGN KEY ("cree_par_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ordres_paiement" ADD CONSTRAINT "ordres_paiement_vise_par_id_fkey" FOREIGN KEY ("vise_par_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lignes_ordre_paiement" ADD CONSTRAINT "lignes_ordre_paiement_ordre_id_fkey" FOREIGN KEY ("ordre_id") REFERENCES "ordres_paiement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lignes_ordre_paiement" ADD CONSTRAINT "lignes_ordre_paiement_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation : l'ordre porte son tenant, la ligne le rejoint par l'ordre.
ALTER TABLE public.ordres_paiement ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.ordres_paiement
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordres_paiement TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.ordres_paiement_id_seq TO prometis_app;

CREATE OR REPLACE FUNCTION app.is_tenant_ordre_paiement(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.ordres_paiement o
      WHERE o.id = p_id AND o.societe_id = app.current_societe_id()
    )
  $$;

ALTER TABLE public.lignes_ordre_paiement ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.lignes_ordre_paiement
  USING (app.is_tenant_ordre_paiement(ordre_id))
  WITH CHECK (app.is_tenant_ordre_paiement(ordre_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lignes_ordre_paiement TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.lignes_ordre_paiement_id_seq TO prometis_app;
