/**
 * Référence QR suisse (QR-facture).
 *
 * 27 chiffres : 26 significatifs + une clé de contrôle calculée par le
 * **modulo 10 récursif**, l'algorithme des anciens BVR repris par la norme
 * QR-facture. C'est cette clé qui permet à la banque de rejeter une référence
 * mal recopiée avant qu'elle ne parte dans le mauvais dossier.
 *
 * La référence est **déterministe** : construite à partir de la clé unique
 * (opération, réservation, étape), elle est identique à chaque calcul. Un
 * appel de fonds rejoué porte donc la même référence, et le rapprochement
 * bancaire ne voit pas deux créances là où il n'y en a qu'une.
 */

/**
 * Table de report du modulo 10 récursif, telle que définie par la norme.
 * Chaque ligne donne le report suivant pour le chiffre lu.
 */
const REPORTS: readonly (readonly number[])[] = [
  [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
  [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
  [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
  [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
  [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
  [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
  [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
  [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
  [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
  [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
];

/** Clé de contrôle d'une suite de chiffres, par modulo 10 récursif. */
export function cleModulo10Recursif(chiffres: string): number {
  if (!/^\d+$/.test(chiffres)) {
    throw new Error(`Le modulo 10 récursif attend des chiffres, reçu « ${chiffres} ».`);
  }
  let report = 0;
  for (const caractere of chiffres) {
    report = REPORTS[report]![Number(caractere)]!;
  }
  return (10 - report) % 10;
}

/** Vrai si les 27 chiffres se terminent par la bonne clé de contrôle. */
export function referenceQRValide(reference: string): boolean {
  const chiffres = reference.replace(/\s/g, '');
  if (!/^\d{27}$/.test(chiffres)) return false;
  return cleModulo10Recursif(chiffres.slice(0, 26)) === Number(chiffres[26]);
}

const remplir = (valeur: number, longueur: number): string => {
  const texte = String(Math.trunc(Math.abs(valeur)));
  if (texte.length > longueur) {
    throw new Error(`La valeur ${valeur} ne tient pas sur ${longueur} chiffres.`);
  }
  return texte.padStart(longueur, '0');
};

/**
 * Construit la référence d'un appel de fonds.
 *
 * Composition des 26 chiffres significatifs :
 *   · 6  — opération
 *   · 10 — réservation
 *   · 10 — étape d'échéancier
 *
 * C'est exactement la clé métier unique d'un appel de fonds. Deux appels ne
 * peuvent donc pas partager une référence, et le même appel en produit
 * toujours la même.
 */
export function genererReferenceQR(
  operationId: number,
  reservationId: number,
  etapeId: number,
): string {
  const significatifs = remplir(operationId, 6) + remplir(reservationId, 10) + remplir(etapeId, 10);
  return significatifs + String(cleModulo10Recursif(significatifs));
}

/** Mise en forme lisible : « 21 00000 00003 13947 14300 09017 ». */
export function formaterReferenceQR(reference: string): string {
  const chiffres = reference.replace(/\s/g, '');
  if (chiffres.length !== 27) return reference;
  return [
    chiffres.slice(0, 2),
    chiffres.slice(2, 7),
    chiffres.slice(7, 12),
    chiffres.slice(12, 17),
    chiffres.slice(17, 22),
    chiffres.slice(22, 27),
  ].join(' ');
}
