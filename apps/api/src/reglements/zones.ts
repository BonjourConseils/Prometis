/**
 * De la zone écrite sur la parcelle à la zone du règlement.
 *
 * L'extrait du registre foncier dit « Zone d'habitat collectif B (3) ». Le
 * règlement de Martigny dit « zone R3 : habitat collectif B ». Personne
 * n'écrit la même chose des deux côtés, et c'est pourtant le même objet :
 * sans ce rapprochement, l'indice reste saisi de mémoire.
 *
 * On rapproche par le **libellé** d'abord, jamais par le numéro seul : « B »
 * et « A » ne diffèrent que d'une lettre, et se tromper de zone fausse la
 * surface brute de plancher — donc le prix qu'on accepte de payer pour un
 * terrain. Quand rien ne ressort franchement, on ne propose rien.
 */

export interface ZoneCandidate {
  id: number;
  code: string;
  libelle: string | null;
}

const sansAccents = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Forme comparable : accents, apostrophes et ponctuation tombent, les
 * espaces se réduisent. « Zone d'habitat collectif B (3) » devient
 * « zone d habitat collectif b 3 ».
 */
export function normaliser(texte: string): string {
  return sansAccents(texte)
    .replace(/[''`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Les codes cités dans un texte : « R3 », « CC », « Ml ». */
function codesCites(texte: string): string[] {
  return (texte.toUpperCase().match(/\b[A-Z]{1,3}\d{0,2}\b/g) ?? []).filter(
    (c) => !MOTS_VIDES.has(c),
  );
}

/** Des mots courts qui ressemblent à des codes sans en être. */
const MOTS_VIDES = new Set(['ZONE', 'DE', 'DU', 'LA', 'LE', 'ET', 'EN', 'A', 'B', 'D', 'L']);

/**
 * La zone du règlement qui correspond à l'affectation saisie, ou `null`.
 *
 * Trois passes, de la plus sûre à la plus fragile :
 *
 *  1. **le libellé** — « habitat collectif B » se lit dans l'affectation ;
 *     le libellé le plus long gagne, pour que « habitat collectif B » passe
 *     avant un « habitat collectif » générique ;
 *  2. **le code écrit en toutes lettres** — l'affectation dit « R3 » ;
 *  3. **le chiffre entre parenthèses** — « (3) » face au code « R3 ».
 *     Dernier recours, et seulement si un seul code s'y prête.
 */
export function correspondreZone(
  affectation: string | null | undefined,
  zones: ZoneCandidate[],
): ZoneCandidate | null {
  const texte = normaliser(affectation ?? '');
  if (texte.length < 3 || zones.length === 0) return null;

  // 1. Le libellé.
  const parLibelle = zones
    .filter((z) => {
      const libelle = normaliser(z.libelle ?? '');
      return libelle.length >= 4 && texte.includes(libelle);
    })
    .sort((a, b) => normaliser(b.libelle ?? '').length - normaliser(a.libelle ?? '').length);
  if (parLibelle.length) return parLibelle[0]!;

  // 2. Le code, cité tel quel.
  const cites = new Set(codesCites(affectation ?? ''));
  const parCode = zones.filter((z) => cites.has(z.code.toUpperCase()));
  if (parCode.length === 1) return parCode[0]!;

  // 3. Le chiffre entre parenthèses — « Zone ... (3) » pour « R3 ».
  //    Ambigu par nature : on s'abstient dès que deux zones y répondent.
  const entreParentheses = (affectation ?? '').match(/\((\d{1,2})\)/);
  if (entreParentheses) {
    const chiffre = entreParentheses[1]!;
    const parChiffre = zones.filter((z) => /^[A-Za-z]+\d{1,2}$/.test(z.code) && z.code.endsWith(chiffre));
    if (parChiffre.length === 1) return parChiffre[0]!;
  }

  return null;
}
