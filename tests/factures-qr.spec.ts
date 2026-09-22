/**
 * Le bulletin QR suisse lu sur une facture reçue.
 *
 * Ce que l'émetteur a écrit dans son bulletin — son nom, son compte, la
 * référence — fait foi sur ce que le modèle a lu dans le texte. Repris de
 * Kourtagimo, avec l'adresse combinée (type K) et l'échéance en plus.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { SwissQRBill } from 'swissqrbill/pdf';
import { Prisma } from '@prisma/client';
import { lireBulletinQr, lireInfosFacturation } from '../apps/api/src/factures/qr-lu';
import { OcrService } from '../apps/api/src/factures/ocr.service';
import { controler, type EntreeControle } from '../apps/api/src/factures/controles';
import {
  ancrer,
  imposerBulletin,
  lectureVide,
  schemaLecture,
} from '../apps/api/src/factures/lecture';

const D = (v: string | number) => new Prisma.Decimal(v);

/** Le bulletin réel d'une facture reçue par Kourtagimo le 16.09.2026. */
const CONTENU = [
  'SPC',
  '0200',
  '1',
  'CH5730767000K53644940',
  'S',
  'immobilier.ch SA',
  'Rue de Lausanne',
  '42-44',
  '1201',
  'Genève',
  'CH',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '82.10',
  'CHF',
  'S',
  'Bonjour Conseils et Immobilier',
  'Rue de l’Aéroport',
  '7',
  '1950',
  'Sion',
  'CH',
  'QRR',
  '108642009115600000000251403',
  '',
  'EPD',
  '//S1/10/91156/11/260810/20/2514/30/215073279/31/260810260810/32/8.1/40/0:30',
].join('\n');

describe('lecture du contenu SPC', () => {
  it('le créancier est l’émetteur, le débiteur celui qui paie', () => {
    const b = lireBulletinQr(CONTENU)!;
    expect(b.creancier).toBe('immobilier.ch SA');
    expect(b.creancierAdresse).toBe('Rue de Lausanne 42-44');
    expect(b.creancierLocalite).toBe('1201 Genève');
    expect(b.debiteur).toBe('Bonjour Conseils et Immobilier');
  });

  it('compte, montant, monnaie, référence', () => {
    expect(lireBulletinQr(CONTENU)).toMatchObject({
      iban: 'CH5730767000K53644940',
      montant: 82.1,
      monnaie: 'CHF',
      typeReference: 'QRR',
      reference: '108642009115600000000251403',
    });
  });

  it('numéro, date, IDE et échéance depuis les informations Swico', () => {
    expect(lireBulletinQr(CONTENU)).toMatchObject({
      numero: '91156',
      dateFacture: '2026-08-10',
      ide: 'CHE-215.073.279',
      dateEcheance: '2026-09-09',
    });
  });

  it('adresse combinée (type K) : deux lignes libres', () => {
    const k = CONTENU.split('\n');
    k[4] = 'K';
    k[6] = 'Rue de Lausanne 42-44';
    k[7] = '1201 Genève';
    k[8] = '';
    k[9] = '';
    const b = lireBulletinQr(k.join('\n'))!;
    expect(b.creancierAdresse).toBe('Rue de Lausanne 42-44');
    expect(b.creancierLocalite).toBe('1201 Genève');
  });

  it('montant laissé libre, sans référence', () => {
    const l = CONTENU.split('\n');
    l[18] = '';
    l[27] = 'NON';
    l[28] = '';
    expect(lireBulletinQr(l.join('\n'))).toMatchObject({ montant: null, reference: null });
  });

  /** Un QR code quelconque sur une facture ne doit rien affirmer. */
  it.each([
    'https://exemple.ch',
    '',
    'SPC',
    CONTENU.replace('CH5730767000K53644940', 'DE89370400440532013000'),
    CONTENU.replace('\nCHF\n', '\nUSD\n'),
    CONTENU.replace('\nQRR\n', '\nXYZ\n'),
  ])('refuse ce qui n’est pas un bulletin suisse valable (%#)', (c) => {
    expect(lireBulletinQr(c)).toBeNull();
  });

  it('période, barre oblique échappée, plusieurs conditions de paiement', () => {
    expect(lireInfosFacturation('//S1/10/A\\/2026\\/7/11/260901260930/40/2:10;0:30')).toEqual({
      numero: 'A/2026/7',
      dateFacture: '2026-09-01',
      ide: null,
      dateEcheance: '2026-10-01',
    });
    expect(lireInfosFacturation('//S1/11/261332').dateFacture).toBeNull();
  });
});

describe('le bulletin fait foi sur la lecture du modèle', () => {
  const b = lireBulletinQr(CONTENU)!;
  const texte = 'Facture 91156\nTotal CHF 82.10';

  it('le créancier remplace un fournisseur mal lu (le débiteur, typiquement)', () => {
    const l = schemaLecture.parse({
      ...lectureVide(),
      fournisseur: 'Bonjour Conseils et Immobilier',
      numero: '91156',
    });
    const imposee = imposerBulletin(l, b);
    expect(imposee.fournisseur).toBe('immobilier.ch SA');
    const a = ancrer(imposee, texte, 'test', { iban: b.iban, referenceQR: b.reference }, b);
    expect(a.champs.fournisseur.ancrage).toBe('qr');
    expect(a.champs.iban).toMatchObject({ valeur: 'CH5730767000K53644940', ancrage: 'qr' });
    expect(a.champs.referenceQR.ancrage).toBe('qr');
    expect(a.qr).toMatchObject({ montant: 82.1, debiteur: 'Bonjour Conseils et Immobilier' });
  });

  it('sans bulletin, rien ne change', () => {
    const l = schemaLecture.parse({ ...lectureVide(), fournisseur: 'X SA' });
    expect(imposerBulletin(l, null)).toEqual(l);
    expect(ancrer(l, texte, 'test', { iban: null, referenceQR: null }).qr).toBeNull();
  });
});

describe('contrôle : le montant du bulletin', () => {
  const entree = (montantQr: string | null): EntreeControle => ({
    facture: {
      numero: '4821',
      type: 'SITUATION',
      dateFacture: new Date('2026-09-10'),
      montantHT: D('187430'),
      tvaPct: D('8.1'),
      montantTVA: D('15181.83'),
      montantTTC: D('202611.83'),
      retenueGarantie: D('18743'),
      acomptesDeduits: null,
      iban: 'CH9300762011623852957',
      montantQr: montantQr ? D(montantQr) : null,
      lignes: [],
    },
    entreprise: { nom: 'Entreprise X SA' },
    contrat: null,
    confianceContrat: null,
    budgetPoste: null,
    arbre: [],
    ibansConnus: [],
    doublons: [],
  });
  const code = (e: EntreeControle) => controler(e).constats.find((c) => c.code === 'qr_montant');

  it('net de retenue : conforme', () => expect(code(entree('183868.83'))).toBeUndefined());
  it('égal au TTC : conforme (la facture n’a pas déduit la retenue)', () =>
    expect(code(entree('202611.83'))).toBeUndefined());
  it('ni l’un ni l’autre : signalé', () =>
    expect(code(entree('210000'))?.titre).toMatch(/CHF 210’000\.00.*CHF 183’868\.83/));
  it('sans bulletin : rien à dire', () => expect(code(entree(null))).toBeUndefined());
});

const poppler = (() => {
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Une facture de `pages` pages, bulletin QR sur la dernière. */
async function factureAvecBulletin(pages: number): Promise<Buffer> {
  const bulletin = new SwissQRBill({
    currency: 'CHF',
    amount: 183868.83,
    creditor: {
      account: 'CH4431999123000889012',
      name: 'Entreprise X SA',
      address: 'Route du Chantier 12',
      zip: 1023,
      city: 'Crissier',
      country: 'CH',
    },
    debtor: {
      name: 'CB Promotions SA',
      address: 'Avenue de la Gare 1',
      zip: 1003,
      city: 'Lausanne',
      country: 'CH',
    },
    reference: '210000000003139471430009017',
    additionalInformation: '//S1/10/4821/11/260910/30/123456789/40/0:30',
  });
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const morceaux: Buffer[] = [];
  doc.on('data', (m: Buffer) => morceaux.push(m));
  const fin = new Promise<void>((r) => doc.on('end', () => r()));
  doc.fontSize(14).text('Entreprise X SA — Facture n° 4821');
  for (let i = 1; i < pages; i++) doc.addPage().text(`Détail, page ${i + 1}`);
  bulletin.attachTo(doc);
  doc.end();
  await fin;
  return Buffer.concat(morceaux);
}

describe.skipIf(!poppler)('décodage réel du QR code, sur le serveur', () => {
  const ocr = new OcrService();

  it('facture d’une page', async () => {
    const b = await ocr.lireQr(await factureAvecBulletin(1), 'application/pdf');
    expect(b).toMatchObject({
      creancier: 'Entreprise X SA',
      iban: 'CH4431999123000889012',
      montant: 183868.83,
      reference: '210000000003139471430009017',
      numero: '4821',
      dateFacture: '2026-09-10',
      dateEcheance: '2026-10-10',
      ide: 'CHE-123.456.789',
      debiteur: 'CB Promotions SA',
    });
  }, 60_000);

  it('bulletin sur la dernière page d’une facture de trois pages', async () => {
    const b = await ocr.lireQr(await factureAvecBulletin(3), 'application/pdf');
    expect(b?.creancier).toBe('Entreprise X SA');
  }, 60_000);

  it('photo JPEG de la facture, comme prise au téléphone', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'qr-photo-'));
    try {
      writeFileSync(join(dossier, 'f.pdf'), await factureAvecBulletin(1));
      execFileSync('pdftoppm', [
        '-r',
        '200',
        '-jpeg',
        '-singlefile',
        join(dossier, 'f.pdf'),
        join(dossier, 'photo'),
      ]);
      const b = await ocr.lireQr(readFileSync(join(dossier, 'photo.jpg')), 'image/jpeg');
      expect(b?.iban).toBe('CH4431999123000889012');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }, 60_000);

  it('une facture sans bulletin rend null, sans erreur', async () => {
    const doc = new PDFDocument();
    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    const fin = new Promise<void>((r) => doc.on('end', () => r()));
    doc.text('Facture sans bulletin');
    doc.end();
    await fin;
    expect(await ocr.lireQr(Buffer.concat(morceaux), 'application/pdf')).toBeNull();
  }, 60_000);

  it('un type qui n’est ni PDF ni image rend null', async () => {
    expect(await ocr.lireQr(Buffer.from('x'), 'text/plain')).toBeNull();
  });
});
