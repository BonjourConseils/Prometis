/**
 * Du corps de métier au poste CFC.
 *
 * Une soumission mal classée fausse tout ce qui suit : l'adjudication
 * atterrit sur le mauvais poste, l'écart budgété / adjugé devient faux, et
 * la facture se rapproche d'un contrat qui ne la concerne pas.
 */
import { describe, expect, it } from 'vitest';
import { proposerPosteCfc, type PosteCfc } from '../apps/web/lib/cfc-metier';

/** Un extrait de la trame, tel qu'il existe sur une promotion. */
const POSTES: PosteCfc[] = [
  { id: 1, code: '2', libelle: 'Bâtiment' },
  { id: 2, code: '21', libelle: 'Gros œuvre 1' },
  { id: 3, code: '211', libelle: 'Travaux de maçonnerie et béton armé' },
  { id: 4, code: '214', libelle: 'Charpente' },
  { id: 5, code: '224', libelle: 'Couverture et étanchéité' },
  { id: 6, code: '232', libelle: 'Installations à courant fort' },
  { id: 7, code: '271', libelle: 'Plâtrerie' },
  { id: 8, code: '281', libelle: 'Revêtements de sol' },
  { id: 9, code: '5', libelle: "Frais secondaires et comptes d'attente" },
  { id: 10, code: '58', libelle: 'Frais de commercialisation' },
];

describe('le libellé du poste d’abord', () => {
  it('le mot du métier se retrouve dans le libellé', () => {
    expect(proposerPosteCfc('Maçonnerie', POSTES)?.code).toBe('211');
    expect(proposerPosteCfc('plâtrerie', POSTES)?.code).toBe('271');
    expect(proposerPosteCfc('CHARPENTE', POSTES)?.code).toBe('214');
  });

  it('les accents et la casse ne comptent pas', () => {
    expect(proposerPosteCfc('etancheite', POSTES)?.code).toBe('224');
  });
});

describe('les mots du chantier que la nomenclature n’emploie pas', () => {
  it('« ferblanterie » vise la couverture', () => {
    expect(proposerPosteCfc('Ferblanterie', POSTES)?.code).toBe('224');
  });

  it('« électricité » vise le courant fort', () => {
    expect(proposerPosteCfc('Électricité', POSTES)?.code).toBe('232');
  });

  it('« carrelage » et « chape » visent les revêtements de sol', () => {
    expect(proposerPosteCfc('Carrelage et faïence', POSTES)?.code).toBe('281');
    expect(proposerPosteCfc('chapes', POSTES)?.code).toBe('281');
  });

  it('« courtage » vise les frais de commercialisation', () => {
    expect(proposerPosteCfc('Commission de courtage', POSTES)?.code).toBe('58');
  });
});

describe('ce qui doit rester à classer à la main', () => {
  it('rien ne ressort : on ne propose pas au hasard', () => {
    expect(proposerPosteCfc('Prestations diverses', POSTES)).toBeNull();
    expect(proposerPosteCfc('', POSTES)).toBeNull();
    expect(proposerPosteCfc(null, POSTES)).toBeNull();
    expect(proposerPosteCfc('ma', POSTES)).toBeNull(); // trop court pour décider
  });

  it('sans poste sur la promotion, aucune proposition', () => {
    expect(proposerPosteCfc('Maçonnerie', [])).toBeNull();
  });
});

describe('le poste le plus précis gagne', () => {
  it('« maçonnerie » ne s’arrête pas au groupe « Gros œuvre »', () => {
    expect(proposerPosteCfc('Maçonnerie', POSTES)?.code).toBe('211');
  });

  /** Le poste précis n'existe pas toujours : on remonte au parent le plus proche. */
  it('à défaut du poste exact, son parent', () => {
    const sansDetail: PosteCfc[] = [
      { id: 1, code: '2', libelle: 'Bâtiment' },
      { id: 2, code: '23', libelle: 'Installations électriques' },
    ];
    expect(proposerPosteCfc('Électricité', sansDetail)?.code).toBe('23');
  });

  it('« pompe à chaleur » passe avant « chauffage »', () => {
    const cvc: PosteCfc[] = [
      { id: 1, code: '24', libelle: 'Chauffage, ventilation' },
      { id: 2, code: '242', libelle: 'Production de chaleur' },
    ];
    expect(proposerPosteCfc('Pompe à chaleur', cvc)?.code).toBe('242');
  });
});
