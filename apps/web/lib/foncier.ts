/**
 * Le terrain : ce qu'une parcelle porte, et les deux chiffres qu'on en tire.
 *
 * Ces deux calculs servent à deux endroits — le total de la page et la ligne
 * de chaque parcelle. Les laisser en double finirait par les faire diverger,
 * et une SBP fausse se voit trop tard : elle décide d'un achat de terrain.
 */

export interface Decoupage {
  id: number;
  type: string;
  libelle: string;
  surfaceM2: string | null;
  pourcentage: string | null;
  ibus: string | null;
}

export interface Parcelle {
  id: number;
  numero: string;
  egrid: string | null;
  commune: string | null;
  surfaceM2: string | null;
  affectationZone: string | null;
  registreFoncier: string | null;
  lienGeoportail: string | null;
  lienRdppf: string | null;
  prixAchat: string | null;
  ibus: string | null;
  decoupages: Decoupage[];
}

export const LIBELLE_DECOUPAGE: Record<string, string> = {
  ZONE_AFFECTATION: "Zone d'affectation",
  DEGRE_SENSIBILITE_BRUIT: 'Degré de sensibilité au bruit',
  AUTRE: 'Autre thème RDPPF',
};

/**
 * Prix au m² et surface brute de plancher : deux chiffres qui décident d'un
 * achat de terrain. Aucun des deux n'est stocké — deux champs qui doivent
 * s'accorder finissent toujours par diverger.
 */
export const prixAuM2 = (p: Parcelle): number | null =>
  p.prixAchat && p.surfaceM2 && Number(p.surfaceM2) > 0
    ? Number(p.prixAchat) / Number(p.surfaceM2)
    : null;

export const sbp = (p: Parcelle): number | null => {
  // Une parcelle à cheval sur deux zones a deux indices : dès qu'une zone
  // porte le sien, c'est zone par zone que la SBP se calcule. Sinon on
  // retombe sur l'indice de la parcelle.
  const zonesIndicees = p.decoupages.filter((d) => d.ibus && d.surfaceM2);
  if (zonesIndicees.length > 0) {
    return zonesIndicees.reduce((t, d) => t + Number(d.surfaceM2) * Number(d.ibus), 0);
  }
  return p.ibus && p.surfaceM2 ? Number(p.surfaceM2) * Number(p.ibus) : null;
};

/**
 * Le canton en toutes lettres.
 *
 * « 3 % en Valais » se lit ; « 3 % en VS » se décode. Sur une estimation
 * qu'on va montrer à un associé, le sigle fait administratif et le nom fait
 * phrase.
 */
export const NOM_CANTON: Record<string, string> = {
  VS: 'Valais',
  VD: 'Vaud',
  GE: 'Genève',
  FR: 'Fribourg',
  NE: 'Neuchâtel',
  JU: 'Jura',
  BE: 'Berne',
  ZH: 'Zurich',
  TI: 'Tessin',
};

export const enToutesLettres = (canton: string | null): string =>
  canton ? (NOM_CANTON[canton.toUpperCase()] ?? canton) : '';

// ---------------------------------------------------------------------
//  L'assiette foncière, agrégée
// ---------------------------------------------------------------------

export interface OperationFonciere {
  canton: string | null;
  fraisNotaireTerrain: string | null;
  droitsMutation: string | null;
}

export interface TauxAcquisition {
  canton: string;
  pourcentage: string;
}

export interface AssietteFonciere {
  surfaceTotale: number;
  /** Somme des prix d'achat des parcelles. */
  prixTotal: number;
  /** Surface brute de plancher constructible, zones indicées comprises. */
  sbpTotale: number;
  /** Notaire et droits de mutation : saisis, ou estimés au taux du canton. */
  fraisAcquisition: number;
  /** Vrai quand les frais sont ESTIMÉS. Un chiffre calculé qui se présente
   *  comme un chiffre connu est la façon la plus sûre de faire signer un
   *  bilan faux : l'affichage le précède d'un « ≈ ». */
  fraisEstimes: boolean;
  /** Le taux utilisé pour l'estimation, pour pouvoir le dire. */
  tauxUtilise: TauxAcquisition | null;
  /** Ce que coûte le terrain par m² que l'on pourra bâtir, frais compris.
   *  Le prix au m² de TERRAIN ne dit rien à lui seul : 663 CHF/m² est cher à
   *  0.6 et bon marché à 1.5. C'est ce coût-ci qui se compare au prix de
   *  vente au m². */
  revientParM2Batir: number | null;
  /** Le même coût tout compris, mais rapporté au m² de TERRAIN. Les deux se
   *  lisent ensemble : l'un dit ce que vaut le sol, l'autre ce que vaut le
   *  droit de bâtir dessus, et leur rapport est l'indice. */
  revientParM2Terrain: number | null;
}

/**
 * Ce que vaut le terrain, lu une seule fois.
 *
 * Le Foncier l'affiche, l'estimatif le reprend en CFC 01 et 02. Recalculer
 * ces sommes de deux côtés les ferait diverger au premier oubli.
 */
export function assiette(
  parcelles: Parcelle[],
  operation: OperationFonciere,
  taux: TauxAcquisition[] = [],
): AssietteFonciere {
  const surfaceTotale = parcelles.reduce((t, p) => t + Number(p.surfaceM2 ?? 0), 0);
  const prixTotal = parcelles.reduce((t, p) => t + Number(p.prixAchat ?? 0), 0);
  const sbpTotale = parcelles.reduce((t, p) => t + (sbp(p) ?? 0), 0);

  const saisis = Number(operation.fraisNotaireTerrain ?? 0) + Number(operation.droitsMutation ?? 0);
  const tauxDuCanton = taux.find((t) => t.canton === operation.canton) ?? null;
  const estimation =
    saisis === 0 && tauxDuCanton && prixTotal > 0
      ? (prixTotal * Number(tauxDuCanton.pourcentage)) / 100
      : null;
  const fraisAcquisition = saisis > 0 ? saisis : (estimation ?? 0);

  return {
    surfaceTotale,
    prixTotal,
    sbpTotale,
    fraisAcquisition,
    fraisEstimes: estimation !== null,
    tauxUtilise: estimation !== null ? tauxDuCanton : null,
    revientParM2Batir: sbpTotale > 0 ? (prixTotal + fraisAcquisition) / sbpTotale : null,
    revientParM2Terrain: surfaceTotale > 0 ? (prixTotal + fraisAcquisition) / surfaceTotale : null,
  };
}
