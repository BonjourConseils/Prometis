-- =====================================================================
--  Sécurité : l'adresse du client dans le journal d'audit, et un journal
--  des connexions (skill `securite-saas`, §8).
-- =====================================================================

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

CREATE TABLE "journal_connexions" (
    "id" SERIAL NOT NULL,
    "compte_id" INTEGER,
    "evenement" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_connexions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "journal_connexions_compte_id_created_at_idx"
  ON "journal_connexions"("compte_id", "created_at");

-- Une connexion précède le choix d'une société : pas de tenant, donc pas de
-- policy possible. Inscrite comme exemption, avec sa raison, pour que le test
-- d'inventaire la distingue d'un oubli.
INSERT INTO app.rls_exemptions (table_name, raison) VALUES
  ('journal_connexions', 'Connexions et échecs : écrits avant le choix d''une société, donc sans tenant. Même statut que comptes ; filtré par compte dans le code. Aucune adresse e-mail n''y est conservée.')
ON CONFLICT (table_name) DO NOTHING;

-- L'application écrit et lit ; elle ne modifie ni n'efface. Un journal qu'on
-- peut réécrire n'atteste de rien.
GRANT SELECT, INSERT ON public.journal_connexions TO prometis_app;
GRANT USAGE, SELECT ON SEQUENCE public.journal_connexions_id_seq TO prometis_app;
