/**
 * Les échéances du passeport — ce qui court encore après la remise des clés.
 *
 * **Calculées, jamais saisies.** Une date de fin de garantie tapée à la main
 * finit par ne plus correspondre à la réception dont elle découle.
 *
 * Deux sources :
 *   · les **contrats** d'entreprise réceptionnés — la garantie SIA 118
 *     (délai d'avis des défauts, 2 ans dès la réception) et la prescription des
 *     droits pour défauts de l'ouvrage (5 ans dès la réception, CO art. 371
 *     al. 2) ;
 *   · les **équipements** — garantie du fabricant, et entretien périodique à
 *     partir du dernier entretien ou, à défaut, de la mise en service.
 */

export type EtatEcheance = 'ECHUE' | 'PROCHE' | 'EN_COURS';

export interface Echeance {
  type: 'GARANTIE_SIA' | 'PRESCRIPTION' | 'GARANTIE_FABRICANT' | 'ENTRETIEN';
  libelle: string;
  fin: Date;
  etat: EtatEcheance;
  contratId?: number;
  equipementId?: number;
}

/** « Proche » : sous 90 jours — le temps d'organiser une visite avant l'échéance. */
export const SEUIL_PROCHE_JOURS = 90;

function plusAns(date: Date, ans: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + ans);
  return d;
}

function plusMois(date: Date, mois: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + mois);
  return d;
}

export function etatDe(fin: Date, maintenant: Date): EtatEcheance {
  if (fin <= maintenant) return 'ECHUE';
  const jours = (fin.getTime() - maintenant.getTime()) / 86_400_000;
  return jours <= SEUIL_PROCHE_JOURS ? 'PROCHE' : 'EN_COURS';
}

export function calculerEcheances(
  contrats: {
    id: number;
    entreprise: string;
    objet: string;
    dateReception: Date | null;
    finGarantie: Date | null;
  }[],
  equipements: {
    id: number;
    designation: string;
    dateMiseEnService: Date | null;
    garantieFabricantFin: Date | null;
    entretienPeriodiciteMois: number | null;
    dernierEntretien: Date | null;
  }[],
  maintenant: Date = new Date(),
): Echeance[] {
  const echeances: Echeance[] = [];

  for (const c of contrats) {
    if (!c.dateReception) continue;
    // `finGarantie` est calculée à l'enregistrement de la réception ; on la
    // recalcule si elle manque, plutôt que de taire une garantie qui court.
    const sia = c.finGarantie ?? plusAns(c.dateReception, 2);
    echeances.push({
      type: 'GARANTIE_SIA',
      libelle: `Garantie SIA 118 — ${c.entreprise} (${c.objet})`,
      fin: sia,
      etat: etatDe(sia, maintenant),
      contratId: c.id,
    });
    const prescription = plusAns(c.dateReception, 5);
    echeances.push({
      type: 'PRESCRIPTION',
      libelle: `Prescription des défauts (CO 371) — ${c.entreprise} (${c.objet})`,
      fin: prescription,
      etat: etatDe(prescription, maintenant),
      contratId: c.id,
    });
  }

  for (const e of equipements) {
    if (e.garantieFabricantFin) {
      echeances.push({
        type: 'GARANTIE_FABRICANT',
        libelle: `Garantie fabricant — ${e.designation}`,
        fin: e.garantieFabricantFin,
        etat: etatDe(e.garantieFabricantFin, maintenant),
        equipementId: e.id,
      });
    }
    const depart = e.dernierEntretien ?? e.dateMiseEnService;
    if (e.entretienPeriodiciteMois && depart) {
      const prochain = plusMois(depart, e.entretienPeriodiciteMois);
      echeances.push({
        type: 'ENTRETIEN',
        libelle: `Entretien — ${e.designation}`,
        fin: prochain,
        etat: etatDe(prochain, maintenant),
        equipementId: e.id,
      });
    }
  }

  return echeances.sort((a, b) => a.fin.getTime() - b.fin.getTime());
}

/**
 * Ce qu'un passeport complet contient, pour dire ce qui manque.
 *
 * Pas un score : une liste de pièces, chacune présente ou non. Un pourcentage
 * laisserait croire qu'un passeport à 80 % est presque bon, alors qu'il lui
 * manque peut-être le PV de réception.
 */
export const PIECES_ATTENDUES: { categorie: string; libelle: string }[] = [
  { categorie: 'PV_RECEPTION', libelle: 'PV de réception de l’ouvrage' },
  { categorie: 'PLAN', libelle: 'Plans conformes à l’exécution' },
  { categorie: 'PERMIS', libelle: 'Permis de construire' },
  { categorie: 'NOTICE', libelle: 'Notices des équipements' },
  { categorie: 'GARANTIE', libelle: 'Certificats de garantie' },
  { categorie: 'CERTIFICAT', libelle: 'Certificats (conformité, énergie…)' },
];
