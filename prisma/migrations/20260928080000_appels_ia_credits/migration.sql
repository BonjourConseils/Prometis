-- Le journal des appels IA au format commun du groupe (skill appels-ia-credits) :
-- l'étage appelé, le fournisseur, la devise — les tarifs Perplexity sont en
-- dollars et se facturent en partie au forfait par requête —, et les crédits
-- débités, stockés puisque la valeur d'un crédit changera.
CREATE TYPE "EtageIa" AS ENUM ('LOCAL', 'PUISSANT', 'RECHERCHE');

ALTER TABLE "appels_ia"
  ADD COLUMN "etage" "EtageIa" NOT NULL DEFAULT 'PUISSANT',
  ADD COLUMN "fournisseur" TEXT NOT NULL DEFAULT 'infomaniak',
  ADD COLUMN "requetes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cout" DECIMAL(12,6),
  ADD COLUMN "devise" TEXT NOT NULL DEFAULT 'CHF',
  ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 0;

-- L'historique existant était en millièmes de franc : il se reprend tel quel.
UPDATE "appels_ia" SET "cout" = "cout_milliemes"::numeric / 1000 WHERE "cout_milliemes" IS NOT NULL;
ALTER TABLE "appels_ia" DROP COLUMN "cout_milliemes";

CREATE INDEX "appels_ia_usage_idx" ON "appels_ia"("usage");
