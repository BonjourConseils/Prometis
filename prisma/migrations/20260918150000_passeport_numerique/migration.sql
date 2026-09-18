-- =====================================================================
--  Passeport numérique de l'ouvrage
--
--  Les équipements livrés — qui les a posés, leur garantie, leur entretien,
--  leur notice — et le journal des appels à l'IA qui propose des équipements
--  à partir des notices. Au passage, `reservations.acquereur_id` reçoit la
--  règle de suppression d'une relation facultative (SET NULL) : la colonne
--  l'est devenue le 03.09.2026 sans que la contrainte suive.
-- =====================================================================

-- CreateEnum
CREATE TYPE "EquipementCategorie" AS ENUM ('CHAUFFAGE', 'VENTILATION', 'SANITAIRE', 'ELECTRICITE', 'PHOTOVOLTAIQUE', 'ASCENSEUR', 'CUISINE', 'MENUISERIE', 'TOITURE', 'FACADE', 'SECURITE', 'AMENAGEMENTS_EXTERIEURS', 'AUTRE');

-- CreateEnum
CREATE TYPE "EquipementStatut" AS ENUM ('PROPOSE', 'VALIDE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentCategorie" ADD VALUE 'NOTICE';
ALTER TYPE "DocumentCategorie" ADD VALUE 'CERTIFICAT';
ALTER TYPE "DocumentCategorie" ADD VALUE 'CONTRAT_ENTRETIEN';

-- DropForeignKey
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_acquereur_id_fkey";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "equipement_id" INTEGER;

-- CreateTable
CREATE TABLE "equipements" (
    "id" SERIAL NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "bien_id" INTEGER,
    "lot_id" INTEGER,
    "categorie" "EquipementCategorie" NOT NULL,
    "designation" TEXT NOT NULL,
    "marque" TEXT,
    "modele" TEXT,
    "numero_serie" TEXT,
    "emplacement" TEXT,
    "entreprise_id" INTEGER,
    "contrat_id" INTEGER,
    "cfc_node_id" INTEGER,
    "date_mise_en_service" TIMESTAMP(3),
    "garantie_fabricant_fin" TIMESTAMP(3),
    "entretien_periodicite_mois" INTEGER,
    "dernier_entretien" TIMESTAMP(3),
    "notes" TEXT,
    "statut" "EquipementStatut" NOT NULL DEFAULT 'VALIDE',
    "source_document_id" INTEGER,
    "source_extrait" TEXT,
    "valide_le" TIMESTAMP(3),
    "valide_par_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appels_ia" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "usage" TEXT NOT NULL,
    "modele" TEXT NOT NULL,
    "tokens_entree" INTEGER,
    "tokens_sortie" INTEGER,
    "cout_milliemes" INTEGER,
    "duree_ms" INTEGER NOT NULL,
    "succes" BOOLEAN NOT NULL,
    "erreur" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appels_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipements_operation_id_idx" ON "equipements"("operation_id");

-- CreateIndex
CREATE INDEX "appels_ia_societe_id_created_at_idx" ON "appels_ia"("societe_id", "created_at");

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_bien_id_fkey" FOREIGN KEY ("bien_id") REFERENCES "biens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_cfc_node_id_fkey" FOREIGN KEY ("cfc_node_id") REFERENCES "cfc_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appels_ia" ADD CONSTRAINT "appels_ia_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_acquereur_id_fkey" FOREIGN KEY ("acquereur_id") REFERENCES "acquereurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_equipement_id_fkey" FOREIGN KEY ("equipement_id") REFERENCES "equipements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
--  Isolation
-- =====================================================================

-- Un équipement appartient à une opération.
ALTER TABLE public.equipements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.equipements
  USING (app.is_tenant_operation(operation_id))
  WITH CHECK (app.is_tenant_operation(operation_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipements TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.equipements_id_seq TO prometis_app;

-- Le journal de l'IA s'écrit et se lit ; il ne se réécrit pas.
ALTER TABLE public.appels_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.appels_ia
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT ON public.appels_ia TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.appels_ia_id_seq TO prometis_app;
