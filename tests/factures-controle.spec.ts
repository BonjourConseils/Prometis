/**
 * Contrôle des factures — lecture ancrée et contrôles déterministes.
 * Le cas de référence est celui du cahier des charges (CFC 211 Maçonnerie).
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { codeLu, controler, couvre, type EntreeControle } from '../apps/api/src/factures/controles';
import {
  ancrer,
  estAncree,
  ibanValide,
  lireIban,
  schemaLecture,
} from '../apps/api/src/factures/lecture';

const D = (v: string | number) => new Prisma.Decimal(v);

const base = (): EntreeControle => ({
  facture: {
    numero: '4821',
    type: 'SITUATION',
    dateFacture: new Date('2026-09-10'),
    montantHT: D('187430'),
    tvaPct: D('8.1'),
    montantTVA: D('15181.83'),
    montantTTC: D('202611.83'),
    retenueGarantie: null,
    acomptesDeduits: null,
    iban: 'CH9300762011623852957',
    lignes: [
      { designation: 'Murs porteurs', codeCfc: '211.31', montant: D('160000') },
      { designation: 'Chapes', codeCfc: '211.32', montant: D('27430') },
    ],
  },
  entreprise: { nom: 'Entreprise X SA' },
  contrat: {
    reference: 'CTR-211',
    base: 'HT',
    forme: 'FORFAIT',
    montant: D('1180000'),
    avenants: D('74500'),
    retenueGarantiePct: D('10'),
    cfc: { code: '211', libelle: 'Maçonnerie' },
    perimetre: ['211', '211.31'],
    dejaFacture: D('670648'),
    enAttente: { nombre: 0, montant: D(0) },
  },
  confianceContrat: 90,
  budgetPoste: D('1250000'),
  arbre: [
    { code: '211', contrat: 'Entreprise X SA' },
    { code: '211.31', contrat: 'Entreprise X SA' },
  ],
  ibansConnus: ['CH9300762011623852957'],
  doublons: [],
});

describe('le cas de référence — CFC 211 Maçonnerie', () => {
  const r = controler(base());
  const codes = r.constats.map((c) => c.code);

  it('avancement facturé cumulé : 68,4 % du commandé (contrat + avenants)', () => {
    expect(r.chiffres.commande).toBe('1254500.00');
    expect(r.chiffres.cumulApres).toBe('858078.00');
    expect(r.chiffres.avancementPct).toBe('68.4');
  });

  it('retenue de garantie de 10 % absente', () => {
    expect(r.constats.find((c) => c.code === 'retenue_absente')?.titre).toMatch(/10 % absente/);
  });

  it('poste 211.32 facturé mais non retrouvé dans l’adjudication', () => {
    const k = r.constats.find((c) => c.code === 'poste_inconnu');
    expect(k?.titre).toBe('Poste 211.32 facturé mais non retrouvé dans l’adjudication.');
    expect(codes).not.toContain('poste_hors_contrat');
  });

  it('le commandé dépasse le budget du poste de 4 500', () => {
    expect(r.constats.find((c) => c.code === 'budget_depasse')?.titre).toMatch(/4’500\.00/);
  });

  it('pas de dépassement du commandé, pas d’alerte bancaire', () => {
    expect(codes).not.toContain('depassement');
    expect(codes).not.toContain('iban_change');
  });

  it('le résumé se lit comme le rapport attendu', () => {
    expect(r.resume[0]).toBe('Facture n° 4821 analysée.');
    expect(r.resume[1]).toBe('CFC probable : 211 Maçonnerie.');
    expect(r.resume[2]).toMatch(/^Contrat : Entreprise X SA/);
    expect(r.resume.join(' ')).toMatch(/68\.4 %/);
  });
});

describe('les autres contrôles', () => {
  it('dépassement du commandé : critique, montant exact', () => {
    const e = base();
    e.contrat!.dejaFacture = D('1100000');
    const r = controler(e);
    expect(r.chiffres.depassement).toBe('32930.00');
    expect(r.constats[0]!.gravite).toBe('critique');
  });

  it('les factures en attente révèlent un dépassement potentiel', () => {
    const e = base();
    e.contrat!.enAttente = { nombre: 2, montant: D('420000') };
    const k = controler(e).constats.find((c) => c.code === 'en_attente');
    expect(k?.gravite).toBe('attention');
    expect(k?.detail).toMatch(/dépassement potentiel de CHF 23’578\.00/);
  });

  it('retenue présente au mauvais taux', () => {
    const e = base();
    e.facture.retenueGarantie = D('9371.50'); // 5 % d'une situation de 187'430
    e.facture.montantHT = D('178058.50');
    const k = controler(e).constats.find((c) => c.code === 'retenue_ecart');
    expect(k?.titre).toMatch(/5\.0 % au lieu des 10 %/);
  });

  it('un avoir n’appelle pas de retenue', () => {
    const e = base();
    e.facture.type = 'AVOIR';
    expect(controler(e).constats.some((c) => c.code === 'retenue_absente')).toBe(false);
  });

  it('IBAN changé : critique', () => {
    const e = base();
    e.facture.iban = 'CH5604835012345678009';
    expect(controler(e).constats[0]!.code).toBe('iban_change');
  });

  it('doublon de numéro : critique', () => {
    const e = base();
    e.doublons = [{ id: 12, operation: 'Les Jardins de Prilly' }];
    expect(
      controler(e).constats.some((c) => c.code === 'doublon' && c.gravite === 'critique'),
    ).toBe(true);
  });

  it('ancien taux de TVA et arithmétique fausse', () => {
    const e = base();
    e.facture.tvaPct = D('7.7');
    e.facture.montantTVA = null;
    const codes = controler(e).constats.map((c) => c.code);
    expect(codes).toContain('tva_ancienne');
    expect(codes).toContain('arithmetique');
  });

  it('un budget non détaillé ne permet pas de juger un poste plus fin', () => {
    const e = base();
    e.contrat!.perimetre = ['211'];
    expect(controler(e).constats.some((c) => c.code === 'poste_inconnu')).toBe(false);
  });

  it('un poste relevant d’un autre contrat est nommé', () => {
    const e = base();
    e.facture.lignes = [{ designation: 'Menuiseries', codeCfc: '221.1', montant: D('1000') }];
    e.arbre.push({ code: '221', contrat: 'Menuiserie Y SA' });
    const k = controler(e).constats.find((c) => c.code === 'poste_hors_contrat');
    expect(k?.detail).toMatch(/CFC 221, couvert par Menuiserie Y SA/);
  });

  it('acomptes déclarés différents de ceux validés', () => {
    const e = base();
    e.facture.acomptesDeduits = D('600000');
    expect(controler(e).constats.some((c) => c.code === 'acomptes_ecart')).toBe(true);
  });

  it('sans contrat : on le dit', () => {
    const e = base();
    e.contrat = null;
    expect(controler(e).constats.some((c) => c.code === 'sans_contrat')).toBe(true);
  });
});

describe('nomenclature CFC', () => {
  it('21 couvre 211, 211 couvre 211.32, pas 212', () => {
    expect(couvre('211', '211.32')).toBe(true);
    expect(couvre('21', '211')).toBe(true);
    expect(couvre('21', '211.3')).toBe(true);
    expect(couvre('211', '212')).toBe(false);
    expect(couvre('211.3', '211.32')).toBe(false);
    expect(couvre('211.3', '211.3.2')).toBe(true);
  });
  it('lit le code sur une ligne de facture', () => {
    expect(codeLu('CFC 211.32 Chapes')).toBe('211.32');
    expect(codeLu('Pos. 4')).toBe('4');
  });
});

describe('lecture ancrée', () => {
  const texte =
    "Entreprise X SA\nFacture n° 4821 du 10.09.2026\nSituation 4\nTotal HT 187'430.00\nTVA 8.1 % 15'181.83\nTotal TTC 202'611.83\nIBAN CH93 0076 2011 6238 5295 7";

  it('un montant écrit à la suisse est ancré', () => {
    expect(estAncree(187430, texte)).toBe(true);
    expect(estAncree(190000, texte)).toBe(false);
  });

  it('IBAN lu localement et vérifié par sa clé', () => {
    expect(lireIban(texte)).toBe('CH9300762011623852957');
    expect(ibanValide('CH9300762011623852958')).toBe(false);
  });

  it('chaque champ reçoit son ancrage, jamais déclaré par le modèle', () => {
    const l = schemaLecture.parse({
      fournisseur: 'Entreprise X SA',
      ide: null,
      numero: '4821',
      dateFacture: '2026-09-10',
      dateEcheance: null,
      type: 'SITUATION',
      montantHT: 187430,
      tvaPct: 8.1,
      montantTVA: 15181.83,
      montantTTC: 999999,
      retenueGarantie: null,
      retenueGarantiePct: null,
      acomptesDeduits: null,
      referenceContrat: null,
      lignes: [],
    });
    const a = ancrer(l, texte, 'test', { iban: lireIban(texte), referenceQR: null });
    expect(a.champs.numero.ancrage).toBe('ancree');
    expect(a.champs.dateFacture.ancrage).toBe('ancree');
    expect(a.champs.montantHT.ancrage).toBe('ancree');
    expect(a.champs.montantTTC.ancrage).toBe('proposee');
    expect(a.champs.tvaPct.ancrage).toBe('ancree');
    expect(a.champs.ide.ancrage).toBe('absente');
    expect(a.champs.type.ancrage).toBe('proposee');
  });
});

describe('base des montants : TTC chez un promoteur', () => {
  /** « En principe on parle de TTC » — CB Promotions, 23.09.2026. */
  const ttc = (): EntreeControle => {
    const e = base();
    e.contrat!.base = 'TTC';
    e.contrat!.montant = D('1275580'); // 1'180'000 HT + 8.1 %
    e.contrat!.avenants = D('80534.50');
    e.contrat!.dejaFacture = D('724970.51');
    return e;
  };

  it('cumule le TTC de la facture, pas son HT', () => {
    const r = controler(ttc());
    expect(r.chiffres.commande).toBe('1356114.50');
    expect(r.chiffres.cumulApres).toBe('927582.34'); // 724'970.51 + 202'611.83
    expect(r.chiffres.avancementPct).toBe('68.4');
  });

  it('un TTC absent se calcule au taux lu, et le dit « proposé » ailleurs', () => {
    const e = ttc();
    e.facture.montantTTC = null;
    expect(controler(e).chiffres.cumulApres).toBe('927582.34');
  });

  it('en base HT, rien ne change pour le cas de référence', () => {
    expect(controler(base()).chiffres.avancementPct).toBe('68.4');
  });
});

describe('facture de solde', () => {
  const solde = (montantHT: string, forme: 'FORFAIT' | 'REGIE' = 'FORFAIT'): EntreeControle => {
    const e = base();
    e.facture.type = 'SOLDE';
    e.facture.montantHT = D(montantHT);
    e.facture.montantTVA = null;
    e.facture.montantTTC = null;
    e.facture.retenueGarantie = D('125450'); // 10 %, présente
    e.contrat!.forme = forme;
    e.contrat!.dejaFacture = D('1100000');
    return e;
  };

  it('solde le commandé au franc près : rien à signaler', () => {
    // 1'254'500 commandés − 1'100'000 déjà facturés = 154'500.
    expect(controler(solde('154500')).constats.some((c) => c.code === 'solde_ecart')).toBe(false);
  });

  it('laisse un reliquat : on le dit', () => {
    const k = controler(solde('140000')).constats.find((c) => c.code === 'solde_ecart');
    expect(k?.gravite).toBe('attention');
    expect(k?.titre).toMatch(/resterait CHF 14’500\.00 non facturés/);
  });

  it('en régie, l’écart n’est qu’une information', () => {
    const k = controler(solde('140000', 'REGIE')).constats.find((c) => c.code === 'solde_ecart');
    expect(k?.gravite).toBe('info');
    expect(k?.detail).toMatch(/en régie/);
  });

  it('une situation ordinaire n’est jamais un solde', () => {
    expect(controler(base()).constats.some((c) => c.code === 'solde_ecart')).toBe(false);
  });
});

describe('retenue de garantie : pas sur les acomptes', () => {
  it('un acompte sans retenue ne déclenche rien', () => {
    const e = base();
    e.facture.type = 'ACOMPTE';
    expect(controler(e).constats.some((c) => c.code === 'retenue_absente')).toBe(false);
  });

  it('une situation sans retenue, si', () => {
    expect(controler(base()).constats.some((c) => c.code === 'retenue_absente')).toBe(true);
  });

  it('une facture de solde sans retenue aussi', () => {
    const e = base();
    e.facture.type = 'SOLDE';
    expect(controler(e).constats.some((c) => c.code === 'retenue_absente')).toBe(true);
  });
});
