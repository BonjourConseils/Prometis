/**
 * En-têtes de sécurité posés sur **toutes** les réponses de l'API.
 *
 * L'API ne sert que du JSON et des fichiers en téléchargement : elle n'a
 * aucune raison d'être affichée dans un cadre, d'exécuter un script ou d'être
 * mise en cache par un intermédiaire. Chacun de ces en-têtes dit « non » à
 * une chose dont elle n'a pas besoin — c'est le cas le plus simple de la règle
 * « chaque couche suppose que la précédente est tombée ».
 */
export function entetesApi(production: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    // Des montants, des noms d'acquéreurs, des IBAN : rien ne doit rester
    // dans le cache d'un proxy ou d'un poste partagé.
    'Cache-Control': 'no-store',
    // HSTS en production seulement : posé sur `localhost`, il forcerait
    // HTTPS sur tous les projets locaux du navigateur pendant un an.
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}
