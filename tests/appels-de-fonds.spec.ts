/**
 * Lot 6 — calculs des appels de fonds et référence QR suisse.
 *
 * Ces montants partent chez de vrais acquéreurs, avec une référence que la
 * banque contrôlera. Une erreur ici ne se rattrape pas par un correctif :
 * elle se rattrape par un courrier d'excuse.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  cleModulo10Recursif,
  formaterReferenceQR,
  genererReferenceQR,
  referenceQRValide,
} from '../apps/api/src/appels-de-fonds/qr-reference.js';
import {
  calculerMontantAppel,
  calculerPrixTotalActe,
  controlerEcheancier,
  estEngagee,
  etatAppel,
  numeroAppel,
} from '../apps/api/src/appels-de-fonds/calculs.js';

const d = (v: string) => new Prisma.Decimal(v);

// =====================================================================

describe('modulo 10 récursif', () => {
  it('calcule la clé de contrôle de la norme', () => {
    // Exemple de référence de la documentation QR-facture :
    // 21 00000 00003 13947 14300 09017 — les 26 premiers chiffres donnent 7.
    expect(cleModulo10Recursif('21000000000313947143000901')).toBe(7);
  });

  it('donne 0 pour une suite de zéros', () => {
    expect(cleModulo10Recursif('0'.repeat(26))).toBe(0);
  });

  it('change dès qu’un chiffre change', () => {
    const a = cleModulo10Recursif('12345678901234567890123456');
    const b = cleModulo10Recursif('12345678901234567890123457');
    expect(a).not.toBe(b);
  });

  it('refuse ce qui n’est pas une suite de chiffres', () => {
    expect(() => cleModulo10Recursif('12A45')).toThrow();
  });
});

describe('référence QR', () => {
  const reference = genererReferenceQR(1, 42, 3);

  it('fait 27 chiffres et porte une clé valide', () => {
    expect(reference).toHaveLength(27);
    expect(referenceQRValide(reference)).toBe(true);
  });

  it('est déterministe — un appel rejoué garde sa référence', () => {
    // Sans ça, le rapprochement bancaire verrait deux créances là où il n'y
    // en a qu'une.
    expect(genererReferenceQR(1, 42, 3)).toBe(reference);
  });

  it('distingue deux appels différents', () => {
    expect(genererReferenceQR(1, 42, 4)).not.toBe(reference);
    expect(genererReferenceQR(1, 43, 3)).not.toBe(reference);
    expect(genererReferenceQR(2, 42, 3)).not.toBe(reference);
  });

  it('encode la clé métier de manière lisible', () => {
    expect(reference.slice(0, 6)).toBe('000001'); // opération
    expect(reference.slice(6, 16)).toBe('0000000042'); // réservation
    expect(reference.slice(16, 26)).toBe('0000000003'); // étape
  });

  it('rejette une référence altérée', () => {
    const altere = reference.slice(0, 26) + String((Number(reference[26]) + 1) % 10);
    expect(referenceQRValide(altere)).toBe(false);
  });

  it('rejette une longueur incorrecte', () => {
    expect(referenceQRValide('123')).toBe(false);
    expect(referenceQRValide(reference + '0')).toBe(false);
  });

  it('se met en forme par blocs, et se relit', () => {
    const formate = formaterReferenceQR(reference);
    expect(formate.split(' ')).toHaveLength(6);
    expect(referenceQRValide(formate)).toBe(true);
  });

  it('refuse un identifiant trop grand pour son champ', () => {
    expect(() => genererReferenceQR(1_234_567, 1, 1)).toThrow();
  });
});

// =====================================================================

describe('montant d’un appel de fonds', () => {
  it('reprend le cas de référence du prototype', () => {
    // Lot A02 : prix total acte 850 000.
    const prix = d('850000');
    expect(calculerMontantAppel(d('5.00'), prix).equals(d('42500'))).toBe(true);
    expect(calculerMontantAppel(d('15.00'), prix).equals(d('127500'))).toBe(true);
  });

  it('arrondit au centime', () => {
    expect(calculerMontantAppel(d('3.33'), d('850000')).equals(d('28305'))).toBe(true);
    expect(calculerMontantAppel(d('7.77'), d('123456.78')).equals(d('9592.59'))).toBe(true);
  });

  it('la somme des étapes rend exactement le prix total acte', () => {
    // 5 + 15 + 25 + 20 + 20 + 10 + 5 = 100
    const prix = d('850000');
    const total = ['5.00', '15.00', '25.00', '20.00', '20.00', '10.00', '5.00']
      .map((p) => calculerMontantAppel(d(p), prix))
      .reduce((t, m) => t.plus(m), new Prisma.Decimal(0));
    expect(total.equals(prix)).toBe(true);
  });
});

describe('prix total acte', () => {
  it('additionne le lot et ses parkings', () => {
    expect(calculerPrixTotalActe(d('815000'), [d('35000')]).equals(d('850000'))).toBe(true);
  });

  it('supporte plusieurs parkings et des prix absents', () => {
    expect(
      calculerPrixTotalActe(d('700000'), [d('30000'), null, d('22000')]).equals(d('752000')),
    ).toBe(true);
  });

  it('sans prix de vente, ne compte que les parkings', () => {
    expect(calculerPrixTotalActe(null, [d('30000')]).equals(d('30000'))).toBe(true);
  });
});

// =====================================================================

describe('réservations engagées', () => {
  it("une option n'est pas un engagement", () => {
    // Appeler des fonds sur une option poserait une créance sur quelqu'un
    // qui n'a rien signé.
    expect(estEngagee('OPTION')).toBe(false);
    expect(estEngagee('EXPIREE')).toBe(false);
    expect(estEngagee('ANNULEE')).toBe(false);
  });

  it('réservé, fonds versés et vendu le sont', () => {
    expect(estEngagee('RESERVE')).toBe(true);
    expect(estEngagee('FONDS_VERSES')).toBe(true);
    expect(estEngagee('VENDU')).toBe(true);
  });
});

// =====================================================================

describe('contrôle de l’échéancier', () => {
  const etape = (id: number, pct: string | null) => ({
    id,
    ordre: id,
    libelle: `Étape ${id}`,
    pourcentage: pct === null ? null : d(pct),
  });

  it('valide un échéancier à 100 %', () => {
    const c = controlerEcheancier([
      etape(1, '5.00'),
      etape(2, '15.00'),
      etape(3, '25.00'),
      etape(4, '20.00'),
      etape(5, '20.00'),
      etape(6, '10.00'),
      etape(7, '5.00'),
      etape(8, null),
    ]);
    expect(c.complet).toBe(true);
    expect(c.ecart.isZero()).toBe(true);
    expect(c.nombreEtapesAppelantes).toBe(7);
    expect(c.nombreJalonsSuivi).toBe(1);
  });

  it('chiffre l’écart plutôt que de dire seulement « incomplet »', () => {
    // 95 % : les 5 % manquants ne seront jamais appelés, et le promoteur
    // s'en apercevrait à la remise des clés.
    const c = controlerEcheancier([etape(1, '50.00'), etape(2, '45.00')]);
    expect(c.complet).toBe(false);
    expect(c.ecart.equals(d('-5'))).toBe(true);
  });

  it('signale aussi un dépassement', () => {
    const c = controlerEcheancier([etape(1, '60.00'), etape(2, '50.00')]);
    expect(c.ecart.equals(d('10'))).toBe(true);
  });

  it('un échéancier fait uniquement de jalons de suivi n’appelle rien', () => {
    const c = controlerEcheancier([etape(1, null), etape(2, null)]);
    expect(c.nombreEtapesAppelantes).toBe(0);
    expect(c.sommePourcentages.isZero()).toBe(true);
  });
});

// =====================================================================

describe('état d’un appel de fonds', () => {
  const echeance = new Date('2026-07-31');
  const avant = new Date('2026-07-15');
  const apres = new Date('2026-08-15');

  it('non encaissé et échu = en retard', () => {
    const e = etatAppel(d('42500'), [], echeance, apres);
    expect(e.enRetard).toBe(true);
    expect(e.soldé).toBe(false);
    expect(e.solde.equals(d('42500'))).toBe(true);
  });

  it('non encaissé mais pas encore échu = pas en retard', () => {
    expect(etatAppel(d('42500'), [], echeance, avant).enRetard).toBe(false);
  });

  it('encaissement partiel', () => {
    const e = etatAppel(d('42500'), [d('20000')], echeance, avant);
    expect(e.partiellementPaye).toBe(true);
    expect(e.soldé).toBe(false);
    expect(e.solde.equals(d('22500'))).toBe(true);
  });

  it('soldé même échu n’est pas en retard', () => {
    const e = etatAppel(d('42500'), [d('20000'), d('22500')], echeance, apres);
    expect(e.soldé).toBe(true);
    expect(e.enRetard).toBe(false);
    expect(e.solde.isZero()).toBe(true);
  });

  it('un versement excédentaire solde sans passer en négatif dans l’affichage', () => {
    const e = etatAppel(d('42500'), [d('43000')], echeance, apres);
    expect(e.soldé).toBe(true);
    expect(e.solde.equals(d('-500'))).toBe(true);
  });
});

describe('numérotation', () => {
  it('produit un numéro lisible et trié', () => {
    expect(numeroAppel(2026, 1)).toBe('AF-2026-0001');
    expect(numeroAppel(2026, 42)).toBe('AF-2026-0042');
  });
});
