-- =====================================================================
--  Facturation Stripe par module (skill plans-payants)
-- =====================================================================

-- AlterTable
ALTER TABLE "souscriptions_modules" ADD COLUMN     "fin_acces" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "tarifs_modules" (
    "id" SERIAL NOT NULL,
    "module" TEXT NOT NULL,
    "prix_mensuel" DECIMAL(12,2) NOT NULL,
    "stripe_price_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarifs_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abonnements_societes" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "statut" TEXT,
    "fin_periode" TIMESTAMP(3),
    "annulation_fin_periode" BOOLEAN NOT NULL DEFAULT false,
    "essai_fin_le" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "abonnements_societes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evenements_stripe" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "societe_id" INTEGER,
    "recu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traite_le" TIMESTAMP(3),
    "erreur" TEXT,

    CONSTRAINT "evenements_stripe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails_facturation" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "cle" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "envoye_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_facturation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passes_quotidiennes" (
    "id" SERIAL NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "envoyes" INTEGER NOT NULL DEFAULT 0,
    "erreur" TEXT,

    CONSTRAINT "passes_quotidiennes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tarifs_modules_module_key" ON "tarifs_modules"("module");

-- CreateIndex
CREATE UNIQUE INDEX "abonnements_societes_societe_id_key" ON "abonnements_societes"("societe_id");

-- CreateIndex
CREATE UNIQUE INDEX "abonnements_societes_stripe_customer_id_key" ON "abonnements_societes"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "abonnements_societes_stripe_subscription_id_key" ON "abonnements_societes"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "emails_facturation_societe_id_cle_reference_key" ON "emails_facturation"("societe_id", "cle", "reference");

-- AddForeignKey
ALTER TABLE "abonnements_societes" ADD CONSTRAINT "abonnements_societes_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails_facturation" ADD CONSTRAINT "emails_facturation_societe_id_fkey" FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
--  Isolation
-- =====================================================================

-- L'abonnement et les e-mails de facturation appartiennent à une société.
ALTER TABLE public.abonnements_societes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.abonnements_societes
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT, UPDATE ON public.abonnements_societes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.abonnements_societes_id_seq TO prometis_app;

ALTER TABLE public.emails_facturation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.emails_facturation
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT ON public.emails_facturation TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.emails_facturation_id_seq TO prometis_app;

-- Trois tables sans tenant, chacune avec sa raison.
INSERT INTO app.rls_exemptions (table_name, raison) VALUES
  ('tarifs_modules', 'Catalogue de la plateforme : le prix de chaque module, commun à toutes les sociétés. Aucune donnée client. Écrit seulement par l''exploitant (second facteur exigé).'),
  ('evenements_stripe', 'Événements Stripe reçus, dédoublonnés avant de savoir à quelle société ils appartiennent. Ne portent que l''identifiant et le type de l''événement.'),
  ('passes_quotidiennes', 'Trace des exécutions de la passe quotidienne, toutes sociétés confondues : début, fin, nombre d''envois. Aucune donnée client.')
ON CONFLICT (table_name) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON public.tarifs_modules TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.tarifs_modules_id_seq TO prometis_app;
GRANT SELECT, INSERT, UPDATE ON public.evenements_stripe TO prometis_app;
GRANT SELECT, INSERT, UPDATE ON public.passes_quotidiennes TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.passes_quotidiennes_id_seq TO prometis_app;

-- =====================================================================
--  Deux lectures hors tenant, bornées au strict nécessaire.
--
--  Un webhook Stripe n'a pas de session : il ne connaît que le client
--  Stripe. La fonction rend l'identifiant de la société, rien d'autre ;
--  le traitement se poursuit ensuite DANS le tenant.
--
--  La passe quotidienne cherche les essais qui finissent bientôt, toutes
--  sociétés confondues : elle ne reçoit que l'identifiant et la date.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.societe_pour_client_stripe(p_client text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT a.societe_id FROM public.abonnements_societes a WHERE a.stripe_customer_id = p_client
  $$;

CREATE OR REPLACE FUNCTION app.essais_a_prevenir(p_jusqua timestamp)
  RETURNS TABLE (societe_id integer, essai_fin_le timestamp)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT a.societe_id, a.essai_fin_le
    FROM public.abonnements_societes a
    WHERE a.statut = 'trialing'
      AND a.essai_fin_le IS NOT NULL
      AND a.essai_fin_le > now()
      AND a.essai_fin_le <= p_jusqua
  $$;

REVOKE EXECUTE ON FUNCTION app.societe_pour_client_stripe(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.essais_a_prevenir(timestamp) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.societe_pour_client_stripe(text) TO prometis_app;
    GRANT EXECUTE ON FUNCTION app.essais_a_prevenir(timestamp) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('societe_pour_client_stripe', 'Webhook Stripe : retrouve la société d''un client Stripe. Rend un identifiant, rien d''autre ; la suite du traitement a lieu dans le tenant.'),
  ('essais_a_prevenir', 'Passe quotidienne : liste les essais qui finissent bientôt (identifiant de société et date) pour l''avertissement J-3.')
ON CONFLICT (nom_fonction) DO NOTHING;
