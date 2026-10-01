/**
 * Du corps de métier au poste CFC — une **proposition**, jamais une décision.
 *
 * Une soumission mal classée fausse tout ce qui suit : l'adjudication
 * atterrit sur le mauvais poste, l'écart budget devient faux, et la facture
 * de l'entreprise se rapproche d'un contrat qui ne la concerne pas. Or
 * personne ne connaît par cœur les codes CFC — « ferblanterie », c'est 224.
 *
 * On cherche d'abord dans les postes **réellement présents** sur la
 * promotion : c'est le budget du promoteur qui fait foi, pas une table
 * figée. La table de synonymes ne sert qu'à rattraper les mots du chantier
 * que la nomenclature n'emploie pas.
 */

export interface PosteCfc {
  id: number;
  code: string;
  libelle: string;
}

const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Les mots du chantier, et le code CFC qu'ils visent. À gauche ce que les
 * gens écrivent, à droite la nomenclature.
 */
const SYNONYMES: [string, string][] = [
  ['terrassement', '201'],
  ['fouille', '201'],
  ['maconnerie', '211'],
  ['beton', '211'],
  ['gros oeuvre', '21'],
  ['echafaudage', '211'],
  ['charpente', '214'],
  ['ossature bois', '214'],
  ['ferblanterie', '224'],
  ['couverture', '224'],
  ['toiture', '224'],
  ['etancheite', '224'],
  ['fenetre', '221'],
  ['vitrage', '221'],
  ['store', '228'],
  ['facade', '226'],
  ['isolation', '226'],
  ['electricite', '232'],
  ['courant fort', '232'],
  ['courant faible', '233'],
  ['chauffage', '242'],
  ['pompe a chaleur', '242'],
  ['ventilation', '244'],
  ['sanitaire', '251'],
  ['plomberie', '251'],
  ['ascenseur', '261'],
  ['platrerie', '271'],
  ['peinture', '285'],
  ['menuiserie', '273'],
  ['porte', '273'],
  ['cuisine', '275'],
  ['armoire', '275'],
  ['serrurerie', '274'],
  ['carrelage', '281'],
  ['faience', '281'],
  ['chape', '281'],
  ['parquet', '281'],
  ['sol', '281'],
  ['nettoyage', '287'],
  ['amenagement exterieur', '4'],
  ['jardin', '42'],
  ['paysagiste', '42'],
  ['architecte', '291'],
  ['ingenieur', '292'],
  ['geometre', '296'],
  ['honoraires', '29'],
  ['courtage', '58'],
  ['commercialisation', '58'],
  ['publicite', '58'],
];

/**
 * Le poste qui correspond le mieux, ou `null` quand rien ne ressort — mieux
 * vaut laisser classer à la main qu'imposer un poste au hasard.
 *
 * L'ordre compte : d'abord le libellé d'un poste de la promotion, ensuite les
 * mots du chantier. Le poste le plus **précis** gagne : « 211 Maçonnerie »
 * plutôt que « 21 Gros œuvre ».
 */
export function proposerPosteCfc(
  corpsMetier: string | null | undefined,
  postes: PosteCfc[],
): PosteCfc | null {
  const terme = sansAccents(corpsMetier ?? '');
  if (terme.length < 3 || postes.length === 0) return null;

  const plusPrecis = (a: PosteCfc, b: PosteCfc) => (b.code.length > a.code.length ? b : a);

  // 1. Le libellé d'un poste contient le terme, ou l'inverse.
  const parLibelle = postes.filter((p) => {
    const libelle = sansAccents(p.libelle);
    return libelle.includes(terme) || terme.includes(libelle);
  });
  if (parLibelle.length) return parLibelle.reduce(plusPrecis);

  // 2. Les mots du chantier : le synonyme le plus long qui apparaît gagne —
  //    « pompe à chaleur » avant « chauffage ».
  const synonymes = SYNONYMES.filter(([mot]) => terme.includes(mot)).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [, code] of synonymes) {
    const exact = postes.find((p) => p.code === code);
    if (exact) return exact;
    // Le poste précis n'existe pas sur cette promotion : on remonte au
    // parent le plus proche — « 211 » absent, « 21 » fera l'affaire.
    for (let n = code.length - 1; n >= 1; n--) {
      const parent = postes.find((p) => p.code === code.slice(0, n));
      if (parent) return parent;
    }
  }
  return null;
}
