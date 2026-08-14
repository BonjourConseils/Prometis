/**
 * Lot 5 — extraction des champs et rapprochement CFC, en pur.
 *
 * L'extraction du PDF vers du texte est déléguée à un service tiers non
 * encore choisi. Ce qui est testé ici est la moitié qui nous appartient :
 * lire les champs métier d'un texte suisse, et proposer une imputation.
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  extraireChamps,
  lireDate,
  lireMontant,
  lireReferenceQR,
} from '../apps/api/src/factures/extraction.js';
import {
  controlerCumul,
  normaliserNom,
  suggererImputation,
  type CandidatContrat,
} from '../apps/api/src/factures/rapprochement.js';

const d = (v: string) => new Prisma.Decimal(v);

// =====================================================================

describe('lecture des montants suisses', () => {
  it("accepte l'apostrophe typographique et l'espace", () => {
    expect(lireMontant('12’450.80')!.equals(d('12450.80'))).toBe(true);
    expect(lireMontant("12'450.80")!.equals(d('12450.80'))).toBe(true);
    expect(lireMontant('12 450.80')!.equals(d('12450.80'))).toBe(true);
  });

  it('accepte la virgule décimale et le sigle CHF', () => {
    expect(lireMontant('12450,80')!.equals(d('12450.80'))).toBe(true);
    expect(lireMontant('CHF 98000')!.equals(d('98000'))).toBe(true);
  });

  it('accepte un avoir négatif', () => {
    expect(lireMontant('-4500.00')!.equals(d('-4500'))).toBe(true);
  });

  it('refuse ce qui n’est pas un montant', () => {
    expect(lireMontant('douze mille')).toBeNull();
    expect(lireMontant('12.345')).toBeNull(); // trois décimales
  });
});

describe('lecture des dates', () => {
  it('lit le format suisse et l’ISO', () => {
    expect(lireDate('30.09.2026')!.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(lireDate('30/09/2026')!.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(lireDate('2026-09-30')!.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('renvoie null sans date', () => {
    expect(lireDate('aucune date ici')).toBeNull();
  });
});

describe('référence QR suisse', () => {
  it('reconnaît 27 chiffres groupés', () => {
    expect(lireReferenceQR('Référence : 21 00000 00000 00000 00603 10001')).toBe(
      '210000000000000000060310001',
    );
  });

  it('rejette une référence trop courte', () => {
    // 23 chiffres : ce n'est pas une référence QR, et l'accepter enverrait
    // un rapprochement bancaire dans le mur.
    expect(lireReferenceQR('Référence : 21 00000 00000 00000 00603 1')).toBeNull();
  });
});

// =====================================================================

const FACTURE = [
  'Plâtrerie Dubois SA',
  'Route de Renens 44 — 1020 Renens',
  '',
  'Facture n° : 2026-0603',
  'Date de facture : 30.09.2026',
  'Chantier : Les Jardins de Prilly — contrat C-2026-014',
  '',
  'Situation n° 2 — plâtrerie et peinture, immeuble A',
  'Total HT : 98’000.00',
  'TVA 8.10 % : 7’938.00',
  'Total TTC : 105’938.00',
  '',
  'Référence : 21 00000 00000 00000 00603 10001',
].join('\n');

describe('extraction complète', () => {
  const champs = extraireChamps(FACTURE);

  it('lit numéro, date et montants', () => {
    expect(champs.numero).toBe('2026-0603');
    expect(champs.dateFacture!.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(champs.montantHT!.equals(d('98000'))).toBe(true);
    expect(champs.tvaPct!.equals(d('8.1'))).toBe(true);
    expect(champs.montantTTC!.equals(d('105938'))).toBe(true);
  });

  it('lit la référence QR et le fournisseur', () => {
    expect(champs.referenceQR).toBe('210000000000000000060310001');
    expect(champs.fournisseurNom).toBe('Plâtrerie Dubois SA');
  });

  it('déduit le taux de TVA quand il manque', () => {
    // Mieux vaut le calculer que laisser un champ vide qu'on remplira au jugé.
    const sansTaux = extraireChamps('Fournisseur X\nTotal HT : 100000\nTotal TTC : 108100');
    expect(sansTaux.tvaPct!.equals(d('8.1'))).toBe(true);
  });

  it('ne déduit pas un taux aberrant', () => {
    const incoherent = extraireChamps('Fournisseur X\nTotal HT : 100\nTotal TTC : 5000');
    expect(incoherent.tvaPct).toBeNull();
  });

  it('ne plante pas sur un texte vide', () => {
    const vide = extraireChamps('');
    expect(vide.numero).toBeNull();
    expect(vide.montantHT).toBeNull();
    expect(vide.fournisseurNom).toBeNull();
  });
});

// =====================================================================

describe('normalisation des raisons sociales', () => {
  it('ignore accents, ponctuation et forme juridique', () => {
    expect(normaliserNom('Plâtrerie Dubois SA')).toBe('platrerie dubois');
    expect(normaliserNom('platrerie dubois s.a.')).toBe('platrerie dubois');
    expect(normaliserNom('PLATRERIE  DUBOIS Sàrl')).toBe('platrerie dubois');
  });

  it('distingue deux entreprises différentes', () => {
    expect(normaliserNom('Dubois SA')).not.toBe(normaliserNom('Duboux SA'));
  });
});

// =====================================================================

const contrat = (
  id: number,
  nom: string,
  cfc: number,
  commande: string,
  facture = '0',
  reference: string | null = null,
): CandidatContrat => ({
  contratId: id,
  reference,
  entrepriseId: id * 10,
  entrepriseNom: nom,
  cfcNodeId: cfc,
  montantCommande: d(commande),
  dejaFacture: d(facture),
});

describe('proposition d’imputation', () => {
  const candidats = [
    contrat(1, 'Plâtrerie Dubois SA', 271, '372500', '145000', 'C-2026-014'),
    contrat(2, 'Rossier Électricité SA', 232, '498000', '0', 'C-2026-021'),
  ];

  it('la référence de contrat citée l’emporte', () => {
    const s = suggererImputation(
      { fournisseurNom: null, montantHT: d('98000'), texte: FACTURE, entrepriseId: null },
      candidats,
    );
    expect(s.contratId).toBe(1);
    expect(s.cfcNodeId).toBe(271);
    expect(s.confiance.equals(d('98'))).toBe(true);
    expect(s.motif).toContain('C-2026-014');
  });

  it('à défaut, le nom du fournisseur suffit s’il n’a qu’un contrat', () => {
    const s = suggererImputation(
      {
        fournisseurNom: 'platrerie dubois s.a.',
        montantHT: d('50000'),
        texte: 'aucune référence',
        entrepriseId: null,
      },
      candidats,
    );
    expect(s.contratId).toBe(1);
    expect(s.confiance.equals(d('90'))).toBe(true);
  });

  it("l'entreprise déjà renseignée prime sur le nom lu", () => {
    const s = suggererImputation(
      {
        fournisseurNom: 'Plâtrerie Dubois SA',
        montantHT: null,
        texte: 'rien',
        entrepriseId: 20,
      },
      candidats,
    );
    expect(s.contratId).toBe(2);
  });

  it('départage plusieurs contrats par le reste à facturer', () => {
    const deux = [
      contrat(1, 'Dubois SA', 271, '100000', '95000'),
      contrat(2, 'Dubois SA', 281, '400000', '0'),
    ];
    const s = suggererImputation(
      { fournisseurNom: 'Dubois SA', montantHT: d('50000'), texte: null, entrepriseId: null },
      deux,
    );
    // Seul le second peut absorber 50 000.
    expect(s.contratId).toBe(2);
    expect(s.confiance.equals(d('70'))).toBe(true);
  });

  it('reste indicatif quand rien ne départage', () => {
    const deux = [
      contrat(1, 'Dubois SA', 271, '400000', '0'),
      contrat(2, 'Dubois SA', 281, '400000', '0'),
    ];
    const s = suggererImputation(
      { fournisseurNom: 'Dubois SA', montantHT: d('1000'), texte: null, entrepriseId: null },
      deux,
    );
    expect(s.confiance.equals(d('45'))).toBe(true);
    expect(s.motif).toContain('à confirmer');
  });

  it('un montant qui solde exactement un contrat est un indice faible mais utile', () => {
    const s = suggererImputation(
      { fournisseurNom: 'Inconnu SA', montantHT: d('227500'), texte: null, entrepriseId: null },
      candidats,
    );
    expect(s.contratId).toBe(1); // 372 500 − 145 000 = 227 500
    expect(s.confiance.equals(d('40'))).toBe(true);
  });

  it('ne propose rien plutôt que n’importe quoi', () => {
    const s = suggererImputation(
      { fournisseurNom: 'Inconnu SA', montantHT: d('12345'), texte: null, entrepriseId: null },
      candidats,
    );
    expect(s.contratId).toBeNull();
    expect(s.cfcNodeId).toBeNull();
    expect(s.confiance.isZero()).toBe(true);
    expect(s.motif).toContain('à la main');
  });

  it('sans aucun contrat, aucune proposition', () => {
    const s = suggererImputation(
      { fournisseurNom: 'Dubois SA', montantHT: d('1000'), texte: FACTURE, entrepriseId: null },
      [],
    );
    expect(s.contratId).toBeNull();
  });

  it('donne toujours un motif lisible', () => {
    // Un comptable qui ne comprend pas la proposition la revérifiera à la
    // main, ce qui annule le gain.
    for (const s of [
      suggererImputation(
        { fournisseurNom: null, montantHT: null, texte: FACTURE, entrepriseId: null },
        candidats,
      ),
      suggererImputation(
        { fournisseurNom: 'Inconnu', montantHT: null, texte: null, entrepriseId: null },
        candidats,
      ),
    ]) {
      expect(s.motif.length).toBeGreaterThan(20);
    }
  });
});

// =====================================================================

describe('contrôle « facturé cumulé ≤ commandé »', () => {
  it('laisse passer sous le commandé', () => {
    const c = controlerCumul(d('372500'), d('145000'), d('98000'));
    expect(c.cumulApres.equals(d('243000'))).toBe(true);
    expect(c.resteAFacturer.equals(d('227500'))).toBe(true);
    expect(c.depasse).toBe(false);
    expect(c.depassement.isZero()).toBe(true);
  });

  it('accepte la facture qui solde exactement', () => {
    const c = controlerCumul(d('372500'), d('145000'), d('227500'));
    expect(c.depasse).toBe(false);
    expect(c.resteAFacturer.equals(d('227500'))).toBe(true);
  });

  it('signale le dépassement et son montant', () => {
    const c = controlerCumul(d('372500'), d('145000'), d('230000'));
    expect(c.depasse).toBe(true);
    expect(c.depassement.equals(d('2500'))).toBe(true);
  });

  it('un avoir diminue le cumul', () => {
    const c = controlerCumul(d('372500'), d('372500'), d('-20000'));
    expect(c.cumulApres.equals(d('352500'))).toBe(true);
    expect(c.depasse).toBe(false);
  });
});
