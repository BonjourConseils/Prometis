-- La reprise datait l'ouverture des modules au jour de la migration. Ils
-- étaient ouverts depuis la création de la société : « Actif depuis le
-- 18.09.2026 » était faux pour tout client antérieur. On rend sa date réelle.
UPDATE public.souscriptions_modules m
SET depuis = s.created_at
FROM public.societes s
WHERE s.id = m.societe_id AND m.source = 'REPRISE';

UPDATE public.historique_modules h
SET created_at = s.created_at
FROM public.societes s
WHERE s.id = h.societe_id AND h.source = 'REPRISE';
