-- =====================================================================
--  Lot 9 — second facteur (TOTP)
--
--  Première extension du modèle depuis sa validation, et elle a été
--  arbitrée explicitement : aucun champ n'existait pour un secret TOTP ni
--  pour des codes de secours, ce qui rendait le MFA impossible à livrer
--  autrement qu'en détournant une colonne pour autre chose que son objet.
--
--  Trois colonnes, sur `comptes` :
--
--    · totp_secret     — secret partagé, CHIFFRÉ au repos (AES-256-GCM,
--      clé dans l'environnement, jamais en base). Il ne peut pas être haché :
--      vérifier un code suppose de le recalculer, donc de le relire.
--    · totp_active_at  — nul tant que l'enrôlement n'est pas confirmé par un
--      premier code valide. Sans cette distinction, un enrôlement interrompu
--      (QR code affiché, application jamais configurée) enfermerait le compte
--      dehors à la connexion suivante.
--    · codes_secours   — empreintes SHA-256 des codes non consommés. Un code
--      utilisé est RETIRÉ du tableau, ce qui donne l'usage unique sans table
--      supplémentaire.
--
--  `comptes` reste exemptée de RLS, comme depuis le Lot 0 : elle est lue au
--  login, avant qu'un tenant existe. Ces colonnes ne changent rien à cela —
--  elles ne contiennent aucune donnée métier, et le secret y est chiffré.
-- =====================================================================

--  Note d'outillage : pas de `DEFAULT` sur `codes_secours`, et pas de
--  `NOT NULL`. Prisma ne sait pas représenter l'un ni l'autre sur une liste
--  scalaire — il en ferait une dérive permanente entre le schéma et la base,
--  et `prisma migrate dev` réclamerait une migration à chaque appel (cf. D-16).
--  Côté client, une liste scalaire absente vaut déjà tableau vide.

ALTER TABLE "public"."comptes"
  ADD COLUMN "totp_secret"    text,
  ADD COLUMN "totp_active_at" timestamp(3),
  ADD COLUMN "codes_secours"  text[];
