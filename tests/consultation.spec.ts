/**
 * Appels d'offres — les règles pures de la consultation.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  depotOuvert,
  empreinteCode,
  empreinteJeton,
  genererCode,
  genererJeton,
  jetonBienForme,
  masquerEmail,
  montantRetenu,
  notePrix,
  offreScellee,
  scorer,
  secretSession,
  verifierCriteres,
} from '../apps/api/src/soumissions/consultation-regles';

const D = (v: string | number) => new Prisma.Decimal(v);
const demain = new Date(Date.now() + 86_400_000);
const hier = new Date(Date.now() - 86_400_000);

describe('accès à l’espace entreprise', () => {
  it('un lien est long, aléatoire, et seule son empreinte se stocke', () => {
    const a = genererJeton();
    expect(jetonBienForme(a)).toBe(true);
    expect(a).not.toBe(genererJeton());
    expect(empreinteJeton(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(empreinteJeton(a)).not.toContain(a);
  });

  it('un jeton mal formé n’atteint pas la base', () => {
    expect(jetonBienForme('../../etc/passwd')).toBe(false);
    expect(jetonBienForme('court')).toBe(false);
  });

  it('le code a six chiffres, et son empreinte dépend de l’invitation', () => {
    const code = genererCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(empreinteCode(code, 1, 's')).not.toBe(empreinteCode(code, 2, 's'));
  });

  it('le secret des sessions entreprise n’est pas celui des comptes', () => {
    expect(secretSession('secret-des-comptes')).not.toBe('secret-des-comptes');
  });

  it('l’adresse est masquée quand on dit où le code est parti', () => {
    expect(masquerEmail('jean@platre.ch')).toBe('j•••@platre.ch');
  });
});

describe('dépôt et scellé', () => {
  const envoyee = { statut: 'ENVOYEE', dateLimite: demain, offresScellees: true };
  const ouverte = { revoqueeLe: null, refuseLe: null };

  it('le dépôt ferme à la date limite, à la révocation, au refus', () => {
    expect(depotOuvert(envoyee, ouverte)).toBe(true);
    expect(depotOuvert({ ...envoyee, dateLimite: hier }, ouverte)).toBe(false);
    expect(depotOuvert(envoyee, { ...ouverte, revoqueeLe: hier })).toBe(false);
    expect(depotOuvert(envoyee, { ...ouverte, refuseLe: hier })).toBe(false);
    expect(depotOuvert({ ...envoyee, statut: 'ADJUGEE' }, ouverte)).toBe(false);
  });

  it('une offre déposée par l’entreprise est scellée jusqu’à la date limite', () => {
    expect(offreScellee(envoyee, { source: 'PORTAIL' })).toBe(true);
    expect(offreScellee({ ...envoyee, dateLimite: hier }, { source: 'PORTAIL' })).toBe(false);
  });

  it('jamais scellée : une offre saisie par le promoteur, ou une consultation sans scellé', () => {
    expect(offreScellee(envoyee, { source: 'SAISIE' })).toBe(false);
    expect(offreScellee({ ...envoyee, offresScellees: false }, { source: 'PORTAIL' })).toBe(false);
  });
});

describe('montant retenu : options et variantes', () => {
  const offre = { montant: D('100000'), remisePct: D('5') };
  const lignes = [
    { id: 1, type: 'OPTION' as const, montant: D('10000') },
    { id: 2, type: 'VARIANTE' as const, montant: D('90000') },
    { id: 3, type: 'VARIANTE' as const, montant: D('95000') },
  ];

  it('l’offre de base, remise déduite', () => {
    expect(montantRetenu(offre, lignes, []).toString()).toBe('95000');
  });

  it('une option s’ajoute, une variante remplace la base', () => {
    expect(montantRetenu(offre, lignes, [1]).toString()).toBe('104500');
    expect(montantRetenu(offre, lignes, [2, 1]).toString()).toBe('95000');
  });

  it('deux variantes ensemble : refusé', () => {
    expect(() => montantRetenu(offre, lignes, [2, 3])).toThrow();
  });
});

describe('notation multicritère', () => {
  const criteres = [
    { id: 1, libelle: 'Prix', poids: D(60), estPrix: true },
    { id: 2, libelle: 'Références', poids: D(25), estPrix: false },
    { id: 3, libelle: 'Délais', poids: D(15), estPrix: false },
  ];

  it('les pondérations font 100, avec un seul critère de prix', () => {
    expect(verifierCriteres(criteres)).toBeNull();
    expect(verifierCriteres([{ poids: D(50), estPrix: true }])).toMatch(/100/);
    expect(
      verifierCriteres([
        { poids: D(50), estPrix: true },
        { poids: D(50), estPrix: true },
      ]),
    ).toMatch(/seul/);
  });

  it('note de prix : 10 au moins-disant, proportionnelle ensuite', () => {
    expect(notePrix(D(100), D(100)).toString()).toBe('10');
    expect(notePrix(D(125), D(100)).toString()).toBe('8');
  });

  it('le score se lit sur 100', () => {
    const s = scorer(
      7,
      criteres,
      new Map([
        [2, D(8)],
        [3, D(6)],
      ]),
      { net: D(125), moinsDisant: D(100) },
    );
    // 60 × 0.8 + 25 × 0.8 + 15 × 0.6 = 48 + 20 + 9
    expect(s.total?.toString()).toBe('77');
  });

  it('un critère non noté laisse le total vide, pas partiel', () => {
    const s = scorer(7, criteres, new Map([[2, D(8)]]), { net: D(100), moinsDisant: D(100) });
    expect(s.total).toBeNull();
    expect(s.manquants).toBe(1);
  });
});
