import { Prisma } from '@prisma/client';

/**
 * Le contrôle d'une facture de construction — pur, déterministe, testé.
 *
 * L'IA a lu ; ici, le code juge. Chaque constat dit ce qu'il a trouvé et d'où
 * il le tient (le contrat, les avenants, les factures déjà validées, le budget
 * du poste). Aucun chiffre de ce rapport ne vient du modèle : ils sont
 * calculés à partir des montants lus — et, après correction humaine, relus.
 */

const ZERO = new Prisma.Decimal(0);
const CENT = new Prisma.Decimal(100);

export type Gravite = 'info' | 'attention' | 'critique';

export interface Constat {
  code: string;
  gravite: Gravite;
  titre: string;
  detail?: string;
}

export interface EntreeControle {
  facture: {
    numero: string | null;
    type: string;
    dateFacture: Date | null;
    montantHT: Prisma.Decimal | null;
    tvaPct: Prisma.Decimal | null;
    montantTVA: Prisma.Decimal | null;
    montantTTC: Prisma.Decimal | null;
    retenueGarantie: Prisma.Decimal | null;
    acomptesDeduits: Prisma.Decimal | null;
    iban: string | null;
    lignes: { designation: string; codeCfc: string | null; montant: Prisma.Decimal }[];
  };
  entreprise: { nom: string } | null;
  contrat: {
    reference: string | null;
    montant: Prisma.Decimal;
    avenants: Prisma.Decimal;
    retenueGarantiePct: Prisma.Decimal | null;
    cfc: { code: string; libelle: string } | null;
    /** Codes CFC couverts : le poste du contrat, ses sous-postes, ceux des avenants. */
    perimetre: string[];
    /** Factures validées ou payées sur ce contrat, hors celle-ci. */
    dejaFacture: Prisma.Decimal;
    /** Autres factures du contrat en attente de validation. */
    enAttente: { nombre: number; montant: Prisma.Decimal };
  } | null;
  /** Suggestion du rapprochement, quand le contrat n'est pas encore choisi. */
  confianceContrat: number | null;
  /** Budget du poste CFC du contrat, sous-postes compris. */
  budgetPoste: Prisma.Decimal | null;
  /** Tous les codes du CFC de l'opération, et le contrat qui couvre chacun. */
  arbre: { code: string; contrat: string | null }[];
  /** IBAN des factures précédentes de la même entreprise. */
  ibansConnus: string[];
  /** Autres factures de la même entreprise portant le même numéro. */
  doublons: { id: number; operation: string }[];
}

export interface Rapport {
  constats: Constat[];
  chiffres: {
    commande: string | null;
    cumulApres: string | null;
    avancementPct: string | null;
    depassement: string | null;
    budgetPoste: string | null;
  };
  resume: string[];
}

/** Taux de TVA suisses en vigueur depuis le 1er janvier 2024. */
const TAUX_TVA = ['8.1', '2.6', '3.8', '0'];
const ANCIENS_TAUX = ['7.7', '2.5', '3.7'];

function formater(d: Prisma.Decimal): string {
  const [e, c] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '-' : ''}CHF ${e!.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}.${c}`;
}

/**
 * Le code CFC `code` est-il couvert par `perimetre` ? La nomenclature est
 * hiérarchique : 21 couvre 211 (chiffres ajoutés), 211 couvre 211.3 et
 * 211.32 (niveaux après le point).
 */
export function couvre(perimetre: string, code: string): boolean {
  const p = perimetre.trim();
  const c = code.trim();
  if (c === p || c.startsWith(`${p}.`)) return true;
  if (!/^\d+$/.test(p)) return false;
  const tete = c.split('.')[0]!;
  return /^\d+$/.test(tete) && tete.length > p.length && tete.startsWith(p);
}

/** Normalisation d'un code lu sur une facture : « CFC 211.32 » → « 211.32 ». */
export function codeLu(brut: string): string | null {
  const m = /(\d{1,3}(?:\.\d{1,3}){0,3})/.exec(brut);
  return m ? m[1]! : null;
}

export function controler(e: EntreeControle): Rapport {
  const c: Constat[] = [];
  const f = e.facture;
  const ht = f.montantHT;

  // --- Identité de la facture -------------------------------------
  if (!ht || ht.lessThanOrEqualTo(0)) {
    c.push({
      code: 'montant_absent',
      gravite: 'critique',
      titre: 'Montant hors taxe absent : rien ne peut être contrôlé.',
    });
  }
  if (!f.numero) {
    c.push({ code: 'numero_absent', gravite: 'attention', titre: 'Numéro de facture absent.' });
  }
  for (const d of e.doublons) {
    c.push({
      code: 'doublon',
      gravite: 'critique',
      titre: `Même numéro déjà enregistré pour ${e.entreprise?.nom ?? 'cette entreprise'}.`,
      detail: `Facture ${d.id} (${d.operation}). Une facture payée deux fois ne se rattrape qu’à la main.`,
    });
  }

  // --- Arithmétique et TVA ----------------------------------------
  if (ht && f.montantTTC) {
    const tva = f.montantTVA ?? (f.tvaPct ? ht.times(f.tvaPct).dividedBy(CENT) : null);
    if (tva) {
      const ecart = ht.plus(tva).minus(f.montantTTC).abs();
      if (ecart.greaterThan(0.1)) {
        c.push({
          code: 'arithmetique',
          gravite: 'attention',
          titre: `HT + TVA ne donne pas le TTC (écart de ${formater(ecart)}).`,
        });
      }
    }
  }
  if (f.tvaPct) {
    const t = f.tvaPct.toString();
    if (ANCIENS_TAUX.includes(t)) {
      c.push({
        code: 'tva_ancienne',
        gravite: 'attention',
        titre: `TVA à ${t} % : c’est un taux abrogé depuis le 1er janvier 2024 (8.1 % aujourd’hui).`,
      });
    } else if (!TAUX_TVA.includes(t)) {
      c.push({
        code: 'tva_inconnue',
        gravite: 'attention',
        titre: `Taux de TVA inhabituel : ${t} %.`,
      });
    }
  }

  // --- IBAN --------------------------------------------------------
  if (f.iban && e.ibansConnus.length && !e.ibansConnus.includes(f.iban)) {
    c.push({
      code: 'iban_change',
      gravite: 'critique',
      titre:
        'Le compte bancaire a changé par rapport aux factures précédentes de cette entreprise.',
      detail:
        'C’est le signe classique d’une fraude au changement de coordonnées : confirmez par téléphone, au numéro connu, avant de payer.',
    });
  }

  // --- Contrat, cumul, avancement ---------------------------------
  let commande: Prisma.Decimal | null = null;
  let cumulApres: Prisma.Decimal | null = null;
  let avancement: Prisma.Decimal | null = null;
  let depassement: Prisma.Decimal | null = null;

  if (!e.contrat) {
    c.push({
      code: 'sans_contrat',
      gravite: 'attention',
      titre: 'Aucun contrat rattaché : cette facture ne se confronte à aucune commande.',
      detail:
        'Choisissez le contrat, ou traitez-la comme une dépense hors commande, en connaissance de cause.',
    });
  } else {
    const k = e.contrat;
    commande = k.montant.plus(k.avenants);
    cumulApres = k.dejaFacture.plus(ht ?? ZERO);
    if (!commande.isZero()) {
      avancement = cumulApres.dividedBy(commande).times(CENT).toDecimalPlaces(1);
      c.push({
        code: 'avancement',
        gravite: 'info',
        titre: `Avancement facturé cumulé : ${avancement.toFixed(1)} % du commandé.`,
        detail: `${formater(cumulApres)} facturés, cette facture comprise, sur ${formater(commande)} (contrat ${formater(k.montant)}${k.avenants.isZero() ? '' : ` + avenants ${formater(k.avenants)}`}).`,
      });
    }
    if (cumulApres.greaterThan(commande)) {
      depassement = cumulApres.minus(commande);
      c.push({
        code: 'depassement',
        gravite: 'critique',
        titre: `Dépassement du commandé : ${formater(depassement)}.`,
        detail:
          'Un avenant manque, ou cette facture est en trop. La validation est bloquée sans décision explicite.',
      });
    }
    if (k.enAttente.nombre > 0) {
      const potentiel = cumulApres.plus(k.enAttente.montant);
      c.push({
        code: 'en_attente',
        gravite:
          potentiel.greaterThan(commande) && !cumulApres.greaterThan(commande)
            ? 'attention'
            : 'info',
        titre: `${k.enAttente.nombre} autre${k.enAttente.nombre > 1 ? 's' : ''} facture${k.enAttente.nombre > 1 ? 's' : ''} du même contrat en attente (${formater(k.enAttente.montant)}).`,
        detail: potentiel.greaterThan(commande)
          ? `Validées toutes, elles porteraient le cumul à ${formater(potentiel)} : dépassement potentiel de ${formater(potentiel.minus(commande))}.`
          : undefined,
      });
    }
    if (e.budgetPoste && commande.greaterThan(e.budgetPoste)) {
      c.push({
        code: 'budget_depasse',
        gravite: 'attention',
        titre: `Le commandé dépasse le budget du poste de ${formater(commande.minus(e.budgetPoste))}.`,
        detail: `Budget ${formater(e.budgetPoste)}${k.cfc ? ` (CFC ${k.cfc.code})` : ''}, commandé ${formater(commande)}.`,
      });
    }

    // --- Retenue de garantie ---------------------------------------
    const pct = k.retenueGarantiePct;
    const soumise = ['SITUATION', 'ACOMPTE'].includes(f.type);
    if (pct && pct.greaterThan(0) && soumise) {
      if (!f.retenueGarantie || f.retenueGarantie.isZero()) {
        c.push({
          code: 'retenue_absente',
          gravite: 'attention',
          titre: `Retenue de garantie de ${pct.toString()} % absente.`,
          detail:
            'Le contrat la prévoit : elle se déduit de chaque situation jusqu’à la réception.',
        });
      } else if (ht) {
        // La retenue se calcule sur la valeur des travaux de la situation,
        // c'est-à-dire avant sa déduction.
        const base = ht.plus(f.retenueGarantie);
        const appliquee = f.retenueGarantie.dividedBy(base).times(CENT).toDecimalPlaces(1);
        if (appliquee.minus(pct).abs().greaterThan(0.5)) {
          c.push({
            code: 'retenue_ecart',
            gravite: 'attention',
            titre: `Retenue de garantie de ${appliquee.toFixed(1)} % au lieu des ${pct.toString()} % du contrat.`,
          });
        }
      }
    }

    // --- Acomptes déclarés ------------------------------------------
    if (f.acomptesDeduits && !f.acomptesDeduits.minus(k.dejaFacture).abs().lessThan(1)) {
      c.push({
        code: 'acomptes_ecart',
        gravite: 'attention',
        titre: `La facture déduit ${formater(f.acomptesDeduits)} d’acomptes antérieurs ; Prometis en a validé ${formater(k.dejaFacture)}.`,
        detail: 'Une situation manque dans Prometis, ou la facture compte mal.',
      });
    }

    // --- Postes hors périmètre ---------------------------------------
    const signales = new Set<string>();
    for (const l of f.lignes) {
      const code = l.codeCfc ? codeLu(l.codeCfc) : null;
      if (!code || signales.has(code)) continue;
      const dansPerimetre = k.perimetre.some((p) => couvre(p, code));
      const noeud = e.arbre.find((n) => n.code === code);
      if (dansPerimetre && noeud) continue;
      signales.add(code);
      if (!dansPerimetre) {
        const ailleurs = e.arbre.find((n) => couvre(n.code, code) && n.contrat);
        c.push({
          code: 'poste_hors_contrat',
          gravite: 'attention',
          titre: `Poste ${code} facturé mais hors du périmètre du contrat.`,
          detail: ailleurs
            ? `Il relève du CFC ${ailleurs.code}, couvert par ${ailleurs.contrat}.`
            : `« ${l.designation} » — ${formater(l.montant)}.`,
        });
      } else {
        c.push({
          code: 'poste_inconnu',
          gravite: 'attention',
          titre: `Poste ${code} facturé mais non retrouvé dans l’adjudication.`,
          detail: `« ${l.designation} » — ${formater(l.montant)}. Ni le budget ni le contrat ne détaillent ce poste : prestation supplémentaire sans avenant ?`,
        });
      }
    }
  }

  // --- Résumé, dans l'ordre où on le lit -----------------------------
  c.sort((a, b) => rang(b.gravite) - rang(a.gravite));
  const resume: string[] = [];
  resume.push(`Facture${f.numero ? ` n° ${f.numero}` : ''} analysée.`);
  if (e.contrat?.cfc) resume.push(`CFC probable : ${e.contrat.cfc.code} ${e.contrat.cfc.libelle}.`);
  if (e.contrat) {
    resume.push(
      `Contrat : ${e.entreprise?.nom ?? '—'}${e.contrat.reference ? ` (${e.contrat.reference})` : ''}` +
        (e.confianceContrat !== null && e.confianceContrat < 90
          ? ` — rapprochement à confirmer (${e.confianceContrat} %).`
          : '.'),
    );
  }
  for (const k of c.filter((x) => x.gravite !== 'info' || x.code === 'avancement'))
    resume.push(k.titre);

  return {
    constats: c,
    chiffres: {
      commande: commande?.toFixed(2) ?? null,
      cumulApres: cumulApres?.toFixed(2) ?? null,
      avancementPct: avancement?.toFixed(1) ?? null,
      depassement: depassement?.toFixed(2) ?? null,
      budgetPoste: e.budgetPoste?.toFixed(2) ?? null,
    },
    resume,
  };
}

function rang(g: Gravite): number {
  return g === 'critique' ? 2 : g === 'attention' ? 1 : 0;
}
