-- =====================================================================
--  L'extrait RDPPF déposé, et non plus seulement lié
-- =====================================================================
--
-- « Le serveur RDPPF est toujours trop lent, il faut permettre
-- d'enregistrer le fichier que l'utilisateur aura téléchargé »
-- (CB Promotions, 19.10.2026).
--
-- Mesuré le même jour sur `rdppf.apps.vs.ch` : plus de deux minutes pour
-- 480 Ko, puis un `502 Bad Gateway` quelques minutes plus tard. Le service
-- cantonal fabrique l'extrait à la demande, et le promoteur l'a presque
-- toujours déjà sur son disque — il vient de le consulter.
--
-- Le lien reste, mais il devient un secours. Le fichier déposé fait foi :
-- c'est la pièce qu'on pourra relire dans trois ans, quand l'URL aura
-- changé ou que le service sera remplacé.

ALTER TABLE "parcelles"
  ADD COLUMN "rdppf_cle_objet" TEXT,
  ADD COLUMN "rdppf_nom_fichier" TEXT,
  ADD COLUMN "rdppf_depose_le" TIMESTAMP(3);
