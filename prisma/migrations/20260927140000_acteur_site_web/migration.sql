-- Le site internet d'un acteur : il manquait, et l'adresse finissait dans le
-- champ « société » faute de place pour elle (CB Promotions, 27.09.2026).
ALTER TABLE "acteurs" ADD COLUMN "site_web" TEXT;
