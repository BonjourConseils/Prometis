#!/usr/bin/env bash
# =====================================================================
#  Prometis — création des rôles PostgreSQL et de la base.
#
#  Deux rôles, et c'est le coeur de l'isolation multi-tenant :
#    · $OWNER_ROLE : propriétaire des tables. Migrations et seed. Contourne
#      la RLS (c'est le propriétaire), donc JAMAIS utilisé par l'application.
#    · $APP_ROLE   : rôle de l'application. NOBYPASSRLS, aucun droit DDL.
#      Toutes les policies s'appliquent à lui.
#
#  Idempotent : rejouable sans effet de bord. Conçu pour tourner sur une
#  instance PostgreSQL partagée avec d'autres projets.
# =====================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-prometis_dev}"
OWNER_ROLE="${OWNER_ROLE:-prometis}"
OWNER_PWD="${OWNER_PWD:-prometis_dev}"
APP_ROLE="${APP_ROLE:-prometis_app}"
APP_PWD="${APP_PWD:-prometis_app_dev}"
ADMIN_DB="${ADMIN_DB:-postgres}"

echo "→ Rôles PostgreSQL ($OWNER_ROLE, $APP_ROLE)"
psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_DB" <<SQL
DO \$do\$
BEGIN
  -- CREATEDB : \`prisma migrate dev\` crée une *shadow database* pour détecter
  -- les dérives de schéma. Nécessaire en développement seulement — la
  -- production utilise \`prisma migrate deploy\`, qui n'en a pas besoin.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
    CREATE ROLE ${OWNER_ROLE} LOGIN CREATEDB PASSWORD '${OWNER_PWD}';
  ELSE
    ALTER ROLE ${OWNER_ROLE} LOGIN CREATEDB PASSWORD '${OWNER_PWD}';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PWD}' NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PWD}' NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
\$do\$;
SQL

if psql -d "$ADMIN_DB" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  echo "→ Base ${DB_NAME} déjà présente"
else
  echo "→ Création de la base ${DB_NAME}"
  createdb -O "$OWNER_ROLE" "$DB_NAME"
fi

echo "→ Propriété et droits sur ${DB_NAME}"
psql -v ON_ERROR_STOP=1 -q -d "$ADMIN_DB" <<SQL
ALTER DATABASE ${DB_NAME} OWNER TO ${OWNER_ROLE};
SQL

psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" <<SQL
-- Le schéma public appartient au propriétaire : c'est lui qui crée les tables
-- via les migrations, donc lui qui peut poser les policies et les GRANT.
ALTER SCHEMA public OWNER TO ${OWNER_ROLE};
-- Le rôle applicatif peut traverser le schéma, mais rien y créer.
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL

echo
echo "✓ Base prête."
echo "  DATABASE_URL        → postgresql://${APP_ROLE}:***@localhost:5432/${DB_NAME}  (RLS appliquée)"
echo "  DIRECT_DATABASE_URL → postgresql://${OWNER_ROLE}:***@localhost:5432/${DB_NAME}  (migrations)"
echo
echo "  Suite : npm run db:migrate && npm run db:seed"
