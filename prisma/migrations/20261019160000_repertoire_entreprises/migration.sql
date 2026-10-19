-- =====================================================================
--  Le répertoire des entreprises : fiche complète et interlocuteurs
-- =====================================================================
--
-- « J'ai un répertoire d'entreprises alors que je n'ai ni envoyé ni reçu
-- de soumissions. Ces entreprises ne sont pas celles de cette promotion,
-- mais d'un répertoire global à l'utilisateur » (CB Promotions,
-- 19.10.2026).
--
-- Le répertoire existait déjà au niveau de la société — c'était sa place
-- dans l'écran d'une promotion qui trompait. Il lui manquait en revanche
-- de quoi être tenu pour lui-même : une adresse, un site web, et des
-- interlocuteurs.
--
-- **Le site web est ce qui remplit la fiche.** Comme pour un acteur : on
-- colle l'adresse, l'app lit la page et propose le reste. D'où sa place en
-- premier champ du formulaire.
--
-- **Les employés** parce que `contact_nom` ne tenait qu'un nom. On parle au
-- chiffreur pour l'offre, au chef de chantier pendant les travaux, à la
-- comptabilité pour les factures : les garder séparément évite de réécrire
-- le même champ à chaque interlocuteur.
--
-- ⚠️ Le compte de policies du test d'inventaire RLS passe de 58 à 59 :
-- `entreprise_employes` en reçoit une. Elle ne porte pas de `societe_id` —
-- son tenant se lit par l'entreprise, comme `lignes_ordre_paiement` par son
-- ordre.

-- AlterTable
ALTER TABLE "entreprises"
  ADD COLUMN "site_web" TEXT,
  ADD COLUMN "adresse" TEXT,
  ADD COLUMN "code_postal" TEXT,
  ADD COLUMN "localite" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "entreprise_employes" (
    "id" SERIAL NOT NULL,
    "entreprise_id" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "fonction" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entreprise_employes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entreprise_employes_entreprise_id_idx" ON "entreprise_employes"("entreprise_id");

-- AddForeignKey
ALTER TABLE "entreprise_employes" ADD CONSTRAINT "entreprise_employes_entreprise_id_fkey" FOREIGN KEY ("entreprise_id") REFERENCES "entreprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation : l'employé rejoint son tenant par l'entreprise.
CREATE OR REPLACE FUNCTION app.is_tenant_entreprise(p_id integer) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.entreprises e
      WHERE e.id = p_id AND e.societe_id = app.current_societe_id()
    )
  $$;

ALTER TABLE public.entreprise_employes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.entreprise_employes
  USING (app.is_tenant_entreprise(entreprise_id))
  WITH CHECK (app.is_tenant_entreprise(entreprise_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entreprise_employes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.entreprise_employes_id_seq TO prometis_app;
