-- Base des montants d'un contrat et forme de ce qui a été validé.
--
-- « En principe on parle de TTC » (CB Promotions, 23.09.2026) : le promoteur
-- raisonne toutes taxes comprises, et les adjudications sont signées ainsi.
-- La base reste corrigeable contrat par contrat, parce qu'une lecture peut
-- se tromper et qu'un bureau technique facture parfois hors taxes.
CREATE TYPE "BaseMontant" AS ENUM ('TTC', 'HT');
CREATE TYPE "FormeContrat" AS ENUM ('FORFAIT', 'REGIE', 'FORFAIT_REGIE');

ALTER TABLE "contrats"
  ADD COLUMN "base" "BaseMontant" NOT NULL DEFAULT 'TTC',
  ADD COLUMN "forme" "FormeContrat" NOT NULL DEFAULT 'FORFAIT';

-- Les contrats déjà nés d'une adjudication portent le montant d'une offre,
-- et les offres se saisissent hors taxes dans Prometis : leur base est HT.
-- Les autres suivent le défaut TTC.
UPDATE "contrats" SET "base" = 'HT' WHERE "adjudication_id" IS NOT NULL;
