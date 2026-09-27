/**
 * Le fichier remis à la banque — pain.001.001.09.
 *
 * C'est le seul endroit du produit qui fait sortir de l'argent : ce qui est
 * faux ne doit pas s'écrire. Les cas viennent des factures réelles de
 * La Praille (ordre de paiement n° 11, 09.2026).
 */
import { describe, expect, it } from 'vitest';
import {
  PaiementInvalide,
  construirePain001,
  estQrIban,
  referenceQrValide,
  referenceScorValide,
  total,
  typeDeReference,
  verifier,
  type OrdreAPayer,
} from '../apps/api/src/paiements/pain001';

/** Coutaz : QR-IBAN et référence QR, telles que lues sur le bulletin. */
const COUTAZ = {
  reference: 'F-33479',
  creancier: 'Coutaz Toiture SA',
  iban: 'CH08 3080 8006 0356 4485 0',
  montant: '39600.00',
  referenceStructuree: '000000000083620000334791006',
};

/** Procéram : bulletin vierge, IBAN ordinaire, communication libre. */
const PROCERAM = {
  reference: 'F-24633',
  creancier: 'Procéram Sàrl',
  iban: 'CH88 0026 5265 6382 0901 K',
  montant: '50000.00',
  referenceStructuree: null,
  communication: 'Facture 24633 — acompte n° 2',
};

const ordre = (lignes: OrdreAPayer['lignes']): OrdreAPayer => ({
  messageId: 'PROMETIS-364-11',
  creeLe: new Date('2026-09-27T08:30:00Z'),
  debiteur: 'CB Promotions SA',
  ibanDebiteur: 'CH9300762011623852957',
  dateExecution: new Date('2026-09-30T00:00:00Z'),
  lignes,
});

describe('ce qui se vérifie avant d’écrire', () => {
  it('un QR-IBAN se reconnaît même avec une lettre', () => {
    expect(estQrIban('CH08 3080 8006 0356 4485 0')).toBe(true);
    expect(estQrIban('CH4431999123000889012')).toBe(true);
    expect(estQrIban('CH88 0026 5265 6382 0901 K')).toBe(false); // IBAN ordinaire
  });

  it('la clé d’une référence QR', () => {
    expect(referenceQrValide('000000000083620000334791006')).toBe(true);
    expect(referenceQrValide('000000000083620000334791007')).toBe(false);
    expect(referenceQrValide('12345')).toBe(false);
  });

  it('la clé d’une référence créancier ISO 11649', () => {
    expect(referenceScorValide('RF18 5390 0754 7034')).toBe(true);
    expect(referenceScorValide('RF19 5390 0754 7034')).toBe(false);
  });

  it('le type se déduit de la référence portée par la facture', () => {
    expect(typeDeReference(COUTAZ)).toBe('QRR');
    expect(typeDeReference(PROCERAM)).toBe('LIBRE');
    expect(typeDeReference({ ...PROCERAM, referenceStructuree: 'RF185390075470' })).toBe('SCOR');
  });

  it('un compte faux, un montant absent : dits en clair, pas écrits', () => {
    const e = verifier(
      ordre([
        { ...COUTAZ, iban: 'CH08 3080 8006 0356 4485 1' },
        { ...PROCERAM, montant: '0' },
      ]),
    );
    expect(e[0]).toMatch(/Coutaz Toiture SA.*IBAN suisse valable/);
    expect(e[1]).toMatch(/Procéram Sàrl.*montant à payer manque/);
  });

  it('référence QR sur un IBAN ordinaire : refusé — la banque rejetterait', () => {
    expect(
      verifier(ordre([{ ...PROCERAM, referenceStructuree: COUTAZ.referenceStructuree }]))[0],
    ).toMatch(/une référence QR suppose un QR-IBAN/);
  });

  it('QR-IBAN sans référence QR : refusé aussi', () => {
    expect(verifier(ordre([{ ...COUTAZ, referenceStructuree: null }]))[0]).toMatch(
      /un QR-IBAN exige une référence QR/,
    );
  });

  it('un ordre vide ne part pas', () => {
    expect(verifier(ordre([]))[0]).toMatch(/aucune facture/);
  });

  it('le total se somme au centime', () => {
    expect(total([COUTAZ, PROCERAM])).toBe('89600.00');
  });
});

describe('le fichier', () => {
  const xml = construirePain001(ordre([COUTAZ, PROCERAM]));

  it('annonce le bon nombre de versements et le bon total', () => {
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>89600.00</CtrlSum>');
    expect(xml).toContain('<ReqdExctnDt><Dt>2026-09-30</Dt></ReqdExctnDt>');
  });

  it('paie depuis le compte de la promotion', () => {
    expect(xml).toContain('<DbtrAcct><Id><IBAN>CH9300762011623852957</IBAN></Id></DbtrAcct>');
    expect(xml).not.toContain('<DbtrAgt>'); // sans BIC, la balise ne s'invente pas
  });

  it('porte la référence QR en structuré, la communication en libre', () => {
    expect(xml).toContain('<Prtry>QRR</Prtry>');
    expect(xml).toContain('<Ref>000000000083620000334791006</Ref>');
    expect(xml).toContain('<Ustrd>Facture 24633 — acompte n° 2</Ustrd>');
  });

  it('écrit les IBAN sans espaces et échappe les noms', () => {
    expect(xml).toContain('<IBAN>CH0830808006035644850</IBAN>');
    expect(construirePain001(ordre([{ ...COUTAZ, creancier: 'Toiture & Fils' }]))).toContain(
      '<Nm>Toiture &amp; Fils</Nm>',
    );
  });

  it('ajoute le BIC quand la banque l’exige', () => {
    const avecBic = construirePain001({ ...ordre([COUTAZ]), bicDebiteur: 'POFICHBEXXX' });
    expect(avecBic).toContain('<BICFI>POFICHBEXXX</BICFI>');
  });

  it('refuse d’écrire un ordre invalide plutôt que de produire un fichier rejeté', () => {
    expect(() => construirePain001(ordre([{ ...COUTAZ, montant: '0' }]))).toThrow(PaiementInvalide);
  });
});
