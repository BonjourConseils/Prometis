-- =====================================================================
--  Modules commerciaux : ce qui se vend, et ce qui reste après résiliation
-- =====================================================================

-- Le passeport numérique de l'ouvrage, nouveau module.
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'PASSEPORT';
ALTER TYPE "AccessModule" ADD VALUE IF NOT EXISTS 'PASSEPORT';

-- Résilier ne détruit rien : les modules résiliés restent lisibles.
ALTER TABLE "societes" ADD COLUMN IF NOT EXISTS "modules_lecture" "AppModule"[] NOT NULL DEFAULT ARRAY[]::"AppModule"[];

-- L'exploitant de la plateforme. Jamais posé par l'API.
ALTER TABLE "comptes" ADD COLUMN IF NOT EXISTS "admin_plateforme" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "StatutSouscription" AS ENUM ('ESSAI', 'ACTIF', 'RESILIE');

CREATE TABLE "souscriptions_modules" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "module" TEXT NOT NULL,
    "statut" "StatutSouscription" NOT NULL,
    "depuis" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin_essai" TIMESTAMP(3),
    "resilie_le" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "stripe_subscription_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "souscriptions_modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "souscriptions_modules_societe_id_module_key" ON "souscriptions_modules"("societe_id", "module");
ALTER TABLE "souscriptions_modules" ADD CONSTRAINT "souscriptions_modules_societe_id_fkey"
  FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "historique_modules" (
    "id" SERIAL NOT NULL,
    "societe_id" INTEGER NOT NULL,
    "module" TEXT NOT NULL,
    "de" "StatutSouscription",
    "vers" "StatutSouscription" NOT NULL,
    "source" TEXT NOT NULL,
    "raison" TEXT,
    "par_compte_id" INTEGER,
    "montant_centimes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historique_modules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "historique_modules_societe_id_created_at_idx" ON "historique_modules"("societe_id", "created_at");
ALTER TABLE "historique_modules" ADD CONSTRAINT "historique_modules_societe_id_fkey"
  FOREIGN KEY ("societe_id") REFERENCES "societes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
--  Isolation : les deux tables portent societe_id.
-- =====================================================================

ALTER TABLE public.souscriptions_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.souscriptions_modules
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.souscriptions_modules TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.souscriptions_modules_id_seq TO prometis_app;

-- L'historique s'écrit et se lit ; il ne se réécrit pas.
ALTER TABLE public.historique_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.historique_modules
  USING (societe_id = app.current_societe_id())
  WITH CHECK (societe_id = app.current_societe_id());
GRANT SELECT, INSERT ON public.historique_modules TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.historique_modules_id_seq TO prometis_app;

-- =====================================================================
--  Reprise : chaque société garde exactement ce qu'elle avait.
--
--  Règle généreuse, et c'est voulu : un module commercial est réputé souscrit
--  dès qu'UN de ses modules techniques est ouvert. Une migration ne retire
--  jamais un accès — au pire elle complète un module à moitié ouvert.
-- =====================================================================

INSERT INTO public.souscriptions_modules (societe_id, module, statut, source, updated_at)
SELECT s.id, m.code, 'ACTIF', 'REPRISE', now()
FROM public.societes s
JOIN (VALUES
  ('APPELS_DE_FONDS',   ARRAY['LOTS','ACQUEREURS','BILAN_PROMOTEUR','ECHEANCIER','APPELS_FONDS','TRESORERIE','COURTAGE']::"AppModule"[]),
  ('CONTROLE_FACTURES', ARRAY['FACTURES']::"AppModule"[]),
  ('APPELS_OFFRES',     ARRAY['SOUMISSIONS','ADJUDICATIONS','CONTRATS']::"AppModule"[])
) AS m(code, techniques) ON s.modules_actifs && m.techniques
ON CONFLICT (societe_id, module) DO NOTHING;

INSERT INTO public.historique_modules (societe_id, module, de, vers, source, raison)
SELECT societe_id, module, NULL, 'ACTIF', 'REPRISE', 'Reprise des modules ouverts avant les modules commerciaux (18.09.2026).'
FROM public.souscriptions_modules WHERE source = 'REPRISE';

-- =====================================================================
--  L'écran de l'exploitant liste les sociétés — toutes.
--
--  `societes` est sous RLS : on n'y lit que la sienne. La fonction rend le
--  minimum qu'il faut pour gérer des modules — nom, profil, modules — et
--  RIEN du contenu d'un client. L'API ne l'appelle qu'après avoir vérifié
--  que le compte est exploitant, avec un second facteur actif.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.societes_pour_exploitant()
  RETURNS TABLE (id integer, raison_sociale text, profil text, modules_actifs text[], modules_lecture text[])
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT s.id, s.raison_sociale, s.profil::text, s.modules_actifs::text[], s.modules_lecture::text[]
    FROM public.societes s
    ORDER BY s.raison_sociale
  $$;

REVOKE EXECUTE ON FUNCTION app.societes_pour_exploitant() FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.societes_pour_exploitant() TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('societes_pour_exploitant', 'Écran de l''exploitant : liste les sociétés pour gérer leurs modules. Rend nom, profil et modules — aucun contenu client. Appelée seulement après vérification du compte exploitant et de son second facteur.')
ON CONFLICT (nom_fonction) DO NOTHING;
