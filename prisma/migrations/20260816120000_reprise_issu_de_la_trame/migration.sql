-- Reprise des données existantes pour `issu_de_la_trame`.
--
-- La migration précédente a ajouté la colonne avec `false` par défaut : sans
-- cette reprise, toute la trame déjà importée passerait pour des postes
-- ajoutés à la main, et l'écran d'estimatif ne pourrait plus la replier.
--
-- La trame est créée en une seule transaction : ses postes partagent la même
-- seconde. Un poste ajouté à la main l'a forcément été plus tard. On applique
-- cette approximation UNE fois, ici ; ensuite le drapeau est posé
-- explicitement par l'import et ne se devine plus jamais.
UPDATE "cfc_nodes" c
SET "issu_de_la_trame" = true
WHERE c."created_at" < (
  SELECT MIN(x."created_at") + interval '5 seconds'
  FROM "cfc_nodes" x
  WHERE x."operation_id" = c."operation_id"
);
