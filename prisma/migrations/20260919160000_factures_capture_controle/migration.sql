-- =====================================================================
--  Contrôle des factures : capture, lecture, contrôle, circuit de visas
-- =====================================================================

-- CreateEnum
CREATE TYPE "VisaEtape" AS ENUM ('DIRECTION_TRAVAUX', 'PROMOTEUR');

-- CreateEnum
CREATE TYPE "VisaDecision" AS ENUM ('APPROUVE', 'REFUSE');

-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "acomptes_deduits" DECIMAL(12,2),
ADD COLUMN     "controle_le" TIMESTAMP(3),
ADD COLUMN     "controles" JSONB,
ADD COLUMN     "date_echeance" TIMESTAMP(3),
ADD COLUMN     "fichier_cle" TEXT,
ADD COLUMN     "fichier_mime" TEXT,
ADD COLUMN     "fichier_nom" TEXT,
ADD COLUMN     "fichier_sha256" TEXT,
ADD COLUMN     "fichier_taille" INTEGER,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "lecture" JSONB,
ADD COLUMN     "lecture_erreur" TEXT,
ADD COLUMN     "lecture_methode" TEXT,
ADD COLUMN     "montant_tva" DECIMAL(12,2),
ADD COLUMN     "reference_qr" TEXT,
ADD COLUMN     "retenue_garantie" DECIMAL(12,2),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SAISIE';

-- CreateTable
CREATE TABLE "facture_lignes" (
    "id" SERIAL NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "designation" TEXT NOT NULL,
    "code_cfc" TEXT,
    "montant" DECIMAL(12,2) NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "facture_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facture_visas" (
    "id" SERIAL NOT NULL,
    "facture_id" INTEGER NOT NULL,
    "etape" "VisaEtape" NOT NULL,
    "decision" "VisaDecision" NOT NULL,
    "par_id" INTEGER NOT NULL,
    "commentaire" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facture_visas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facture_lignes_facture_id_idx" ON "facture_lignes"("facture_id");

-- CreateIndex
CREATE INDEX "facture_visas_facture_id_idx" ON "facture_visas"("facture_id");

-- CreateIndex
CREATE UNIQUE INDEX "factures_societe_id_fichier_sha256_key" ON "factures"("societe_id", "fichier_sha256");

-- AddForeignKey
ALTER TABLE "facture_lignes" ADD CONSTRAINT "facture_lignes_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facture_visas" ADD CONSTRAINT "facture_visas_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Les deux nouvelles tables rejoignent leur tenant par la facture.
ALTER TABLE public.facture_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.facture_lignes
  USING (app.is_tenant_facture(facture_id))
  WITH CHECK (app.is_tenant_facture(facture_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facture_lignes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.facture_lignes_id_seq TO prometis_app;

-- Un visa s'ajoute ; il ne se modifie ni ne s'efface.
ALTER TABLE public.facture_visas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.facture_visas
  USING (app.is_tenant_facture(facture_id))
  WITH CHECK (app.is_tenant_facture(facture_id));
GRANT SELECT, INSERT ON public.facture_visas TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.facture_visas_id_seq TO prometis_app;
