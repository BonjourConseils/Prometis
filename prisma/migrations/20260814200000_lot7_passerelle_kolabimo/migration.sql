-- =====================================================================
--  Lot 7 — passerelle Kolabimo : le second « pré-tenant »
--
--  Un webhook entrant n'a pas de jeton, donc pas d'espace de travail : il
--  n'est pas émis par un humain connecté. Le tenant doit donc être déduit
--  de la clé d'API présentée, et cette lecture-là précède le contexte
--  tenant — exactement le problème résolu au Lot 1 pour le sélecteur
--  d'espace, et résolu ici de la même manière.
--
--  `api_keys` porte une policy sur societe_id : sans tenant, elle renvoie
--  zéro ligne. D'où une fonction SECURITY DEFINER, scopée à UNE clé passée
--  en paramètre, qui ne peut rien révéler d'autre que la société à laquelle
--  cette clé appartient — soit précisément ce que son porteur sait déjà.
--
--  Mêmes précautions qu'au Lot 1 : search_path figé, aucun SQL dynamique,
--  EXECUTE retiré à PUBLIC, et inscription à l'inventaire pour que le test
--  de sécurité échoue si une fonction apparaît sans avoir été relue.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.societe_de_cle_api(p_cle text)
  RETURNS TABLE (api_key_id integer, societe_id integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT k.id, k.societe_id
    FROM public.api_keys k
    WHERE k.key = p_cle
      AND k.is_active IS TRUE
  $$;

REVOKE EXECUTE ON FUNCTION app.societe_de_cle_api(text) FROM PUBLIC;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prometis_app') THEN
    GRANT EXECUTE ON FUNCTION app.societe_de_cle_api(text) TO prometis_app;
  END IF;
END
$do$;

INSERT INTO app.security_definer_autorisees (nom_fonction, raison) VALUES
  ('societe_de_cle_api', 'Passerelle Kolabimo : résout le tenant d''un webhook entrant depuis la clé d''API présentée, avant qu''un contexte tenant existe. Scopée à une clé, ne renvoie que son propriétaire.')
ON CONFLICT (nom_fonction) DO NOTHING;

-- =====================================================================
--  Journal des webhooks : le filtrage y est APPLICATIF, pas en RLS
--
--  `webhook_events` ne porte pas de societe_id — le schéma le veut ainsi,
--  parce qu'un événement entrant est journalisé AVANT qu'on sache à qui il
--  appartient (charge illisible, signature invalide, promotion inconnue).
--  C'est l'une des deux tables inscrites à `app.rls_exemptions`.
--
--  Conséquence à ne pas perdre de vue : rien en base n'empêche un tenant de
--  lire les événements d'un autre. La société traitée est écrite dans la
--  charge (`payload->>'societeId'`) et le service filtre dessus ; c'est un
--  test d'étanchéité qui tient cette promesse, pas PostgreSQL.
--
--  L'index rend ce filtre utilisable sans parcourir tout le journal.
-- =====================================================================

CREATE INDEX IF NOT EXISTS webhook_events_societe_idx
  ON public.webhook_events ((payload ->> 'societeId'));

-- Le journal se lit du plus récent au plus ancien, écran par écran.
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON public.webhook_events (received_at DESC);
