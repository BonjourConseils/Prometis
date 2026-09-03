-- =====================================================================
--  Dossier acquéreur : N personnes par réservation
--
--  Kolabimo ne livre l'identité qu'au palier FONDS_VERSES, et il en livre
--  PLUSIEURS : couple, indivision, société. Deux conséquences ici —
--  `reservations.acquereur_id` devient facultatif (une réservation existe
--  avant d'avoir un nom), et le dossier devient une table de liaison qui
--  porte le rôle et la quote-part en fraction.
-- =====================================================================

-- Complément d'identité livré au palier.
ALTER TABLE "acquereurs" ADD COLUMN "type" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "date_naissance" TIMESTAMP(3);
ALTER TABLE "acquereurs" ADD COLUMN "nationalite" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "npa" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "localite" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "pays" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "raison_sociale" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "ide" TEXT;
ALTER TABLE "acquereurs" ADD COLUMN "ordre" INTEGER NOT NULL DEFAULT 0;

-- Kolabimo ne donne pas d'identifiant par personne : le couple
-- (référence de dossier, rang) est ce qui rend l'upsert stable.
CREATE UNIQUE INDEX "acquereurs_societe_id_kolabimo_client_ref_ordre_key"
  ON "acquereurs"("societe_id", "kolabimo_client_ref", "ordre");

ALTER TABLE "reservations" ALTER COLUMN "acquereur_id" DROP NOT NULL;
ALTER TABLE "reservations" ADD COLUMN "kolabimo_client_ref" TEXT;

CREATE TABLE "reservation_acquereurs" (
    "id" SERIAL NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "acquereur_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "quote_part" TEXT,
    "signataire" BOOLEAN NOT NULL DEFAULT false,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_acquereurs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservation_acquereurs_reservation_id_acquereur_id_key"
  ON "reservation_acquereurs"("reservation_id", "acquereur_id");
CREATE INDEX "reservation_acquereurs_reservation_id_idx"
  ON "reservation_acquereurs"("reservation_id");

ALTER TABLE "reservation_acquereurs" ADD CONSTRAINT "reservation_acquereurs_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservation_acquereurs" ADD CONSTRAINT "reservation_acquereurs_acquereur_id_fkey"
  FOREIGN KEY ("acquereur_id") REFERENCES "acquereurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise : les dossiers existants ont une seule personne, déjà pointée par
-- `acquereur_id`. On la déclare signataire — c'est ce qu'elle était de fait.
INSERT INTO "reservation_acquereurs" ("reservation_id", "acquereur_id", "role", "signataire", "ordre")
SELECT r.id, r.acquereur_id, 'ACQUEREUR', true, 0
FROM public.reservations r
WHERE r.acquereur_id IS NOT NULL;

-- Et la référence de dossier, jusqu'ici portée par la seule personne.
UPDATE public.reservations r
SET kolabimo_client_ref = a.kolabimo_client_ref
FROM public.acquereurs a
WHERE a.id = r.acquereur_id AND a.kolabimo_client_ref IS NOT NULL;

-- =====================================================================
--  Isolation multi-tenant
--
--  `reservation_acquereurs` ne porte pas de `societe_id` : son rattachement
--  passe par la réservation. Sans policy, le dossier acquéreur — donc des
--  noms, des e-mails et des quotes-parts — traverserait les sociétés.
-- =====================================================================

ALTER TABLE public.reservation_acquereurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.reservation_acquereurs
  USING (app.is_tenant_reservation(reservation_id))
  WITH CHECK (app.is_tenant_reservation(reservation_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservation_acquereurs TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.reservation_acquereurs_id_seq TO prometis_app;
