#!/usr/bin/env bash
# =====================================================================
#  Vérification complète : build, API, suite de tests.
#
#  Une partie des tests tape l'API HTTP réelle. Lancer `npm test` sans
#  API échoue — ce script démarre l'API, attend qu'elle réponde, joue la
#  suite, puis l'arrête, quel que soit le résultat.
#
#  C'est la commande de reprise : elle dit en une fois si le dépôt est sain.
# =====================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RACINE"

PORT="${API_PORT:-3001}"
JOURNAL="$(mktemp -t prometis-api)"
API_PID=""

nettoyer() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap nettoyer EXIT

echo "→ Build"
npm run build --silent > /dev/null

# Un serveur déjà en écoute servirait un binaire périmé : on refuse plutôt
# que de tester la mauvaise version.
if lsof -ti:"$PORT" > /dev/null 2>&1; then
  echo "✗ Le port $PORT est déjà occupé." >&2
  echo "  Arrêter le serveur en cours, ou les tests joueraient contre un binaire périmé." >&2
  exit 1
fi

echo "→ Démarrage de l'API sur le port $PORT"
node apps/api/dist/main.js > "$JOURNAL" 2>&1 &
API_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "✗ L'API s'est arrêtée au démarrage :" >&2
    tail -20 "$JOURNAL" >&2
    exit 1
  fi
  sleep 0.5
done

if ! curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
  echo "✗ L'API n'a pas répondu dans le délai imparti :" >&2
  tail -20 "$JOURNAL" >&2
  exit 1
fi

echo "→ Tests"
npm test

echo
echo "✓ Dépôt sain."
