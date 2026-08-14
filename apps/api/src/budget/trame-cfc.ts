/**
 * Trame CFC de départ.
 *
 * ⚠️ Ce n'est **pas** le catalogue CRB. Les catalogues détaillés du CRB
 * (Centre suisse d'études pour la rationalisation de la construction) sont
 * des ouvrages sous licence : ils ne peuvent pas être recopiés ici.
 *
 * Ce qui suit est la structure des groupes principaux et des sous-groupes du
 * Code des frais de construction, telle qu'elle est publiquement documentée
 * et utilisée dans toute la branche. Elle sert de **point de départ** à une
 * opération : le promoteur l'adapte, ajoute ses niveaux 3 et 4, et peut
 * remplacer l'ensemble par un export de son propre catalogue CRB.
 */

export interface NoeudTrame {
  code: string;
  libelle: string;
  enfants?: NoeudTrame[];
}

export const TRAME_CFC: NoeudTrame[] = [
  {
    code: '0',
    libelle: 'Terrain',
    enfants: [
      { code: '01', libelle: 'Achat du terrain' },
      { code: '02', libelle: "Frais d'acquisition" },
      { code: '03', libelle: 'Taxes de raccordement' },
      { code: '05', libelle: 'Indemnités et servitudes' },
    ],
  },
  {
    code: '1',
    libelle: 'Travaux préparatoires',
    enfants: [
      { code: '10', libelle: 'Relevés, études géotechniques' },
      { code: '11', libelle: 'Déblaiement, préparation du terrain' },
      { code: '12', libelle: 'Démolitions' },
      { code: '13', libelle: 'Installations de chantier communes' },
      { code: '17', libelle: 'Fondations spéciales' },
    ],
  },
  {
    code: '2',
    libelle: 'Bâtiment',
    enfants: [
      { code: '20', libelle: 'Excavation' },
      {
        code: '21',
        libelle: 'Gros œuvre 1',
        enfants: [
          { code: '211', libelle: 'Travaux de maçonnerie et béton armé' },
          { code: '213', libelle: "Constructions en éléments d'ossature" },
          { code: '214', libelle: 'Charpente' },
        ],
      },
      {
        code: '22',
        libelle: 'Gros œuvre 2',
        enfants: [
          { code: '221', libelle: 'Fenêtres et portes extérieures' },
          { code: '222', libelle: 'Ferblanterie' },
          { code: '224', libelle: 'Couverture et étanchéité' },
          { code: '225', libelle: 'Isolations spéciales' },
          { code: '226', libelle: 'Crépissage de façade' },
          { code: '228', libelle: 'Stores et protection solaire' },
        ],
      },
      {
        code: '23',
        libelle: 'Installations électriques',
        enfants: [
          { code: '231', libelle: 'Appareils à courant fort' },
          { code: '232', libelle: 'Installations à courant fort' },
          { code: '235', libelle: 'Installations à courant faible' },
          { code: '236', libelle: 'Télématique et sécurité' },
        ],
      },
      {
        code: '24',
        libelle: 'Chauffage, ventilation, conditionnement',
        enfants: [
          { code: '242', libelle: 'Production de chaleur' },
          { code: '244', libelle: 'Installations de ventilation' },
          { code: '246', libelle: 'Distribution de chaleur' },
        ],
      },
      {
        code: '25',
        libelle: 'Installations sanitaires',
        enfants: [
          { code: '251', libelle: 'Appareils sanitaires' },
          { code: '252', libelle: 'Conduites sanitaires' },
          { code: '258', libelle: 'Agencements de cuisine' },
        ],
      },
      { code: '26', libelle: 'Installations de transport' },
      {
        code: '27',
        libelle: 'Aménagements intérieurs 1',
        enfants: [
          { code: '271', libelle: 'Plâtrerie' },
          { code: '272', libelle: 'Ouvrages métalliques' },
          { code: '273', libelle: 'Menuiserie' },
          { code: '275', libelle: 'Systèmes de verrouillage' },
        ],
      },
      {
        code: '28',
        libelle: 'Aménagements intérieurs 2',
        enfants: [
          { code: '281', libelle: 'Revêtements de sol' },
          { code: '282', libelle: 'Revêtements de paroi' },
          { code: '285', libelle: 'Traitement des surfaces intérieures' },
          { code: '287', libelle: 'Nettoyage du bâtiment' },
        ],
      },
      {
        code: '29',
        libelle: 'Honoraires',
        enfants: [
          { code: '291', libelle: 'Architecte' },
          { code: '292', libelle: 'Ingénieur civil' },
          { code: '293', libelle: 'Ingénieur électricien' },
          { code: '294', libelle: 'Ingénieur CVC' },
          { code: '296', libelle: 'Spécialistes' },
        ],
      },
    ],
  },
  { code: '3', libelle: "Équipements d'exploitation" },
  {
    code: '4',
    libelle: 'Aménagements extérieurs',
    enfants: [
      { code: '41', libelle: 'Constructions extérieures' },
      { code: '42', libelle: 'Jardins et plantations' },
      { code: '43', libelle: 'Installations extérieures' },
      { code: '44', libelle: 'Routes, places, chemins' },
    ],
  },
  {
    code: '5',
    libelle: "Frais secondaires et comptes d'attente",
    enfants: [
      { code: '51', libelle: 'Autorisations, taxes, émoluments' },
      { code: '52', libelle: 'Échantillons, maquettes, reproductions' },
      { code: '53', libelle: 'Assurances de construction' },
      { code: '56', libelle: 'Intérêts intercalaires du crédit de construction' },
      { code: '58', libelle: 'Frais de commercialisation' },
      { code: '59', libelle: 'Réserve pour imprévus' },
    ],
  },
  { code: '9', libelle: 'Ameublement et décoration' },
];
