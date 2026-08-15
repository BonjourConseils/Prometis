/**
 * Lot 9 — ce qui peut légalement figurer sur une QR-facture.
 *
 * La règle qui coûte cher si on la découvre en production : **une référence
 * QR à 27 chiffres n'est valable qu'avec un QR-IBAN**. L'émettre sur un IBAN
 * ordinaire produit un document que la banque refuse — et l'acquéreur croit
 * avoir payé.
 */
import { describe, expect, it } from 'vitest';
import {
  adresseUtilisable,
  choisirReference,
  decouperAdresse,
  estQrIban,
  normaliserIban,
} from '../apps/api/src/appels-de-fonds/qr-facture';

/** Celui du seed : identifiant d'institution 30000, donc dans la plage QR. */
const QR_IBAN = 'CH57 3000 0123 4567 8901 2';
/** Un IBAN suisse ordinaire : institution 00762, hors plage. */
const IBAN_ORDINAIRE = 'CH93 0076 2011 6238 5295 7';
const REFERENCE = '210000000003139471430009017';

describe('Reconnaissance d’un QR-IBAN', () => {
  it('accepte un identifiant d’institution dans la plage 30000–31999', () => {
    expect(estQrIban(QR_IBAN)).toBe(true);
    expect(estQrIban('CH4431999123000889012')).toBe(true);
  });

  it('refuse un IBAN suisse ordinaire', () => {
    expect(estQrIban(IBAN_ORDINAIRE)).toBe(false);
  });

  it('refuse ce qui n’est pas un IBAN suisse', () => {
    expect(estQrIban('DE89370400440532013000')).toBe(false);
    expect(estQrIban('')).toBe(false);
    expect(estQrIban(null)).toBe(false);
    expect(estQrIban('CH57 3000')).toBe(false);
  });

  it('ignore les espaces de saisie', () => {
    expect(normaliserIban(QR_IBAN)).toBe('CH5730000123456789012');
    expect(estQrIban(normaliserIban(QR_IBAN))).toBe(true);
  });
});

describe('Choix de la référence', () => {
  it('porte la référence QR sur un QR-IBAN', () => {
    const mode = choisirReference(QR_IBAN, REFERENCE, 'AF-2026-0014');
    expect(mode).toEqual({ type: 'QRR', reference: REFERENCE });
  });

  it('n’en porte AUCUNE sur un IBAN ordinaire, et dit pourquoi', () => {
    const mode = choisirReference(IBAN_ORDINAIRE, REFERENCE, 'AF-2026-0014');
    expect(mode.type).toBe('AUCUNE');
    if (mode.type === 'AUCUNE') {
      expect(mode.message).toContain('AF-2026-0014');
      expect(mode.raison).toContain('QR-IBAN');
    }
  });

  it('se rabat sur le message quand la société n’a pas d’IBAN', () => {
    const mode = choisirReference(null, REFERENCE, 'AF-2026-0014');
    expect(mode.type).toBe('AUCUNE');
  });

  it('se rabat aussi quand l’appel n’a pas de référence', () => {
    expect(choisirReference(QR_IBAN, null, 'AF-2026-0014').type).toBe('AUCUNE');
  });
});

describe('Découpage d’une adresse libre', () => {
  it('sépare la rue du NPA et de la localité', () => {
    expect(decouperAdresse('Sophie Meylan', 'Chemin des Vignes 12\n1004 Lausanne')).toEqual({
      nom: 'Sophie Meylan',
      adresse: 'Chemin des Vignes 12',
      codePostal: '1004',
      localite: 'Lausanne',
      pays: 'CH',
    });
  });

  it('accepte une adresse écrite sur une seule ligne', () => {
    const a = decouperAdresse('X', 'Rue du Lac 3, 1800 Vevey');
    expect(a.codePostal).toBe('1800');
    expect(a.localite).toBe('Vevey');
  });

  it('ne perd rien quand le NPA est absent', () => {
    // Mieux vaut une rue trop longue qu'une adresse tronquée en silence.
    const a = decouperAdresse('X', 'Quelque part en montagne');
    expect(a.adresse).toBe('Quelque part en montagne');
    expect(adresseUtilisable(a)).toBe(false);
  });

  it('supporte une adresse vide', () => {
    const a = decouperAdresse('X', null);
    expect(a.nom).toBe('X');
    expect(adresseUtilisable(a)).toBe(false);
  });

  it('juge utilisable une adresse complète', () => {
    expect(adresseUtilisable(decouperAdresse('X', 'Rue 1\n1000 Lausanne'))).toBe(true);
  });
});
