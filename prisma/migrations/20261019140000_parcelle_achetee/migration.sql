-- =====================================================================
--  La parcelle achetée : son acte, son prix payé, ses frais réels
-- =====================================================================
--
-- « Pour chacune des parcelles il faudra prévoir également d'uploader
-- l'acte de vente, une fois la parcelle achetée, ainsi que le prix
-- réellement payé et les frais d'acquisition. La parcelle passera alors en
-- "Achetée" » (CB Promotions, 19.10.2026).
--
-- **Un seul champ de prix**, et c'est délibéré. `prix_achat` porte le prix
-- négocié tant que la parcelle est envisagée, puis le prix payé une fois
-- l'acte signé. Deux champs qui doivent s'accorder finissent toujours par
-- diverger — c'est la règle que ce code applique partout, et la raison pour
-- laquelle le prix au m² et la surface à bâtir ne sont pas stockés.
-- L'historique n'est pas perdu pour autant : les versions de budget gardent
-- ce qui avait été estimé.
--
-- Les frais, eux, méritent leur champ : jusqu'ici ils n'existaient qu'au
-- niveau de l'opération, saisis ou estimés au taux du canton. Une fois
-- l'acte signé, ils sont connus parcelle par parcelle. L'écran additionne
-- donc le réel là où il est connu et l'estimation ailleurs — en le disant.
--
-- Deux états seulement. La promesse de vente est un vrai jalon du métier,
-- mais tant qu'aucun écran ne s'en sert, un état de plus encombrerait tous
-- ceux qui l'affichent.

-- CreateEnum
CREATE TYPE "ParcelleStatut" AS ENUM ('ENVISAGEE', 'ACHETEE');

-- AlterTable
ALTER TABLE "parcelles"
  ADD COLUMN "statut" "ParcelleStatut" NOT NULL DEFAULT 'ENVISAGEE',
  ADD COLUMN "frais_acquisition" DECIMAL(12,2),
  ADD COLUMN "date_achat" TIMESTAMP(3),
  ADD COLUMN "acte_cle_objet" TEXT,
  ADD COLUMN "acte_nom_fichier" TEXT;
