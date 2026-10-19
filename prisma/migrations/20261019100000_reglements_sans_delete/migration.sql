-- =====================================================================
--  Référence partagée : on ne supprime pas pour les autres
-- =====================================================================
--
-- La migration précédente annonçait que le rôle applicatif ne pourrait pas
-- supprimer une commune ni un règlement — un `GRANT SELECT, INSERT, UPDATE`
-- sans DELETE. Il n'en était rien : `ALTER DEFAULT PRIVILEGES` (migration
-- `20260814080500_rls_multi_tenant`) accorde SELECT/INSERT/UPDATE/DELETE à
-- toute table créée ensuite. Le GRANT plus étroit n'enlevait rien, il
-- ajoutait à des droits déjà donnés.
--
-- Un commentaire qui décrit une protection inexistante est pire que pas de
-- commentaire : on s'y fie. On révoque donc explicitement.
--
-- Pourquoi ces deux tables et pas les autres : elles ne portent pas de
-- `societe_id`. Une ligne supprimée disparaît pour TOUS les tenants, pas
-- seulement pour celui qui a cliqué. Remplacer un règlement périmé se fait
-- par UPDATE ; supprimer une commune reste un geste d'administration, à
-- faire avec le rôle propriétaire.
--
-- Les zones gardent DELETE : une relecture du règlement les remplace, et
-- elles n'existent que par leur règlement.

REVOKE DELETE ON public.communes FROM prometis_app;
REVOKE DELETE ON public.reglements_communaux FROM prometis_app;
