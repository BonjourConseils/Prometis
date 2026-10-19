/**
 * Quels passages d'un règlement envoyer au modèle.
 *
 * Un RCCZ fait 190 000 caractères — l'envoyer entier coûte cher, noie le
 * signal, et la fenêtre de contexte finirait par le tronquer n'importe où.
 * Or ce qu'on cherche tient dans quelques pages : la liste des zones, et le
 * **tableau synoptique** en annexe, qui donne densité, hauteurs, distances
 * et degré de sensibilité au bruit colonne par colonne.
 *
 * On découpe donc en blocs, on les note sur les mots qui comptent, et on
 * garde les meilleurs **dans l'ordre du document** — un tableau remis dans
 * le désordre ne se lit plus.
 */

/** Les mots qui désignent un paramètre constructible, et leur poids. */
const MOTS: [RegExp, number][] = [
  [/tableau\s+des\s+zones/gi, 10],
  [/densit[ée]/gi, 4],
  [/indice\s+d['’]?utilisation|indice\s+u\b/gi, 4],
  [/emprise\s+au\s+sol/gi, 4],
  [/h(auteur)?\.?\s*max/gi, 4],
  [/distance\s+(à|a)\s+la\s+limite|distance\s+aux\s+limites/gi, 4],
  [/degr[ée]\s+de\s+sensibilit[ée]|sens\.?\s*au\s*bruit|OPB/gi, 3],
  [/alignements?\s+urbains?/gi, 3],
  [/plan\s+d['’]?affectation\s+sp[ée]cial|PAS\b/gi, 2],
  [/se\s+subdivisent?\s+en/gi, 5],
  [/zones?\s+(à|a)\s+b[âa]tir/gi, 3],
  [/habitat\s+(collectif|individuel)/gi, 2],
  [/niveaux?/gi, 1],
  [/gabarit/gi, 1],
  [/contigu/gi, 1],
];

export interface Passage {
  /** Index du premier bloc, pour remettre les passages dans l'ordre. */
  position: number;
  texte: string;
  score: number;
}

/**
 * Les passages les plus denses en paramètres, dans l'ordre du document.
 *
 * `maxCaracteres` borne ce qui part au modèle : 30 000 caractères valent
 * ~9 000 jetons, assez pour la liste des zones et le tableau annexe.
 */
export function passagesUtiles(texte: string, maxCaracteres = 30_000): string {
  const lignes = texte.split('\n');
  if (lignes.length === 0) return '';

  const PAR_BLOC = 30;
  const blocs: Passage[] = [];
  for (let i = 0; i < lignes.length; i += PAR_BLOC) {
    const morceau = lignes.slice(i, i + PAR_BLOC).join('\n');
    let score = 0;
    for (const [motif, poids] of MOTS) {
      const trouves = morceau.match(motif);
      if (trouves) score += trouves.length * poids;
    }
    // Une table des matières cite tous les titres sans porter un chiffre :
    // beaucoup de mots, aucune valeur. Les points de conduite la trahissent.
    const pointsDeConduite = (morceau.match(/\.{6,}/g) ?? []).length;
    if (pointsDeConduite > 3) score = Math.round(score / (1 + pointsDeConduite));
    blocs.push({ position: i, texte: morceau, score });
  }

  const retenus: Passage[] = [];
  let taille = 0;
  for (const bloc of [...blocs].sort((a, b) => b.score - a.score)) {
    if (bloc.score === 0) break;
    if (taille + bloc.texte.length > maxCaracteres) continue;
    retenus.push(bloc);
    taille += bloc.texte.length;
  }

  return retenus
    .sort((a, b) => a.position - b.position)
    .map((b) => b.texte)
    .join('\n\n[…]\n\n');
}
