/**
 * Clés d'API de la passerelle Kolabimo utilisées par le seed.
 *
 * Dans un fichier à part parce que les tests en ont besoin sans pouvoir
 * importer `seed.ts` — l'importer exécuterait le seed. Les recopier des deux
 * côtés marcherait jusqu'au jour où l'une des copies changerait seule.
 *
 * Ce sont des valeurs de **développement** : elles vivent dans un dépôt
 * public, servent à la fois d'identifiant de tenant et de secret de signature,
 * et doivent être régénérées avant toute mise en ligne.
 */
export const CLE_API_PROBAT = 'pk_dev_probat_5f3a9c1e7b2d4086a1c5e9f30b7d2846';
export const CLE_API_CONSTRUCTA = 'pk_dev_constructa_2c8e14a7d05b39f6428ae1cd70b95f3a';
