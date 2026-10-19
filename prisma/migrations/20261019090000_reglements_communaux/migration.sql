-- =====================================================================
--  Le règlement communal — ce que la commune autorise à bâtir
-- =====================================================================
--
-- « Il faut que l'app retrouve le RCCZ de Martigny en ligne, ou alors que
-- l'on puisse stocker le fichier en lien avec la commune » (CB Promotions,
-- 19.10.2026). Le promoteur saisit « Zone d'habitat collectif B (3) » sur sa
-- parcelle et tape ensuite un indice de mémoire ; or c'est cet indice qui
-- commande la surface brute de plancher, donc toute la faisabilité.
--
-- RÉFÉRENCE PARTAGÉE, et c'est délibéré : un RCCZ est un document public,
-- identique pour tous les promoteurs qui bâtissent dans la commune. Ces
-- trois tables n'ont donc ni `societe_id` ni policy RLS — comme
-- `tarifs_modules`. Les cloisonner obligerait chaque client à redéposer le
-- même PDF et à repayer son interprétation, pour un résultat identique.
--
-- Conséquence sur les droits : le rôle applicatif peut LIRE et ÉCRIRE, mais
-- ne peut PAS SUPPRIMER une commune ni un règlement. Un clic malheureux ne
-- doit pas faire disparaître pour tous les tenants un document que l'un
-- d'eux a déposé. Les zones, elles, se suppriment : une relecture du
-- règlement les remplace.

-- CreateTable
CREATE TABLE "communes" (
    "id" SERIAL NOT NULL,
    "nom" TEXT NOT NULL,
    "canton" VARCHAR(2) NOT NULL,
    "numero_ofs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglements_communaux" (
    "id" SERIAL NOT NULL,
    "commune_id" INTEGER NOT NULL,
    "titre" TEXT NOT NULL,
    "version" TEXT,
    "url" TEXT,
    "cle_objet" TEXT,
    "nom_fichier" TEXT,
    "texte" TEXT,
    "methode_lecture" TEXT,
    "nb_pages" INTEGER,
    "lu_le" TIMESTAMP(3),
    "erreur" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglements_communaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones_reglement" (
    "id" SERIAL NOT NULL,
    "reglement_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT,
    "indice" DECIMAL(6,3),
    "hauteur_max_m" DECIMAL(6,2),
    "niveaux_max" INTEGER,
    "distance_limite_m" DECIMAL(6,2),
    "degre_sensibilite" TEXT,
    "places_par_logement" DECIMAL(6,2),
    "conditions" TEXT,
    "extrait" TEXT,
    "ancrage" TEXT NOT NULL DEFAULT 'propose',
    "valide_le" TIMESTAMP(3),
    "valide_par_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_reglement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "communes_numero_ofs_key" ON "communes"("numero_ofs");
CREATE UNIQUE INDEX "communes_nom_canton_key" ON "communes"("nom", "canton");
CREATE INDEX "reglements_communaux_commune_id_idx" ON "reglements_communaux"("commune_id");
CREATE UNIQUE INDEX "zones_reglement_reglement_id_code_key" ON "zones_reglement"("reglement_id", "code");
CREATE INDEX "zones_reglement_reglement_id_idx" ON "zones_reglement"("reglement_id");

-- AddForeignKey
ALTER TABLE "reglements_communaux" ADD CONSTRAINT "reglements_communaux_commune_id_fkey" FOREIGN KEY ("commune_id") REFERENCES "communes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zones_reglement" ADD CONSTRAINT "zones_reglement_reglement_id_fkey" FOREIGN KEY ("reglement_id") REFERENCES "reglements_communaux"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Référence partagée : PAS de RLS, donc aucune policy. Le test d'inventaire
-- compte les policies ; ces trois tables n'en ajoutent aucune, et le compte
-- de 58 reste juste. Ce n'est pas un oubli : c'est la raison d'être de ces
-- tables.
GRANT SELECT, INSERT, UPDATE ON public.communes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.communes_id_seq TO prometis_app;

GRANT SELECT, INSERT, UPDATE ON public.reglements_communaux TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.reglements_communaux_id_seq TO prometis_app;

-- Les zones se remplacent à chaque relecture : DELETE est nécessaire ici.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zones_reglement TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.zones_reglement_id_seq TO prometis_app;
