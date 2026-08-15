/**
 * Rédaction du procès-verbal d'une séance.
 *
 * Pur : on entre une séance, ses participants et ses points, il en sort un
 * texte. Aucune base, aucun fichier — donc testable au caractère près, ce qui
 * compte pour un document qui fait foi entre un promoteur et ses entreprises.
 *
 * Le format est du Markdown : lisible tel quel dans un e-mail ou un éditeur,
 * et convertible plus tard sans rien réécrire. Un PDF mis en page suppose de
 * choisir un moteur de rendu — c'est la même décision que pour la QR-facture,
 * et elle n'est pas prise.
 */

export type StatutPoint = 'OUVERT' | 'EN_COURS' | 'CLOS';

export interface ParticipantPv {
  nom: string;
  organisation?: string | null;
  present: boolean;
}

export interface PointPv {
  ordre: number;
  titre: string;
  contenu?: string | null;
  responsable?: string | null;
  echeance?: Date | null;
  statut: StatutPoint;
}

export interface SeancePv {
  titre: string;
  numero?: string | null;
  type: string;
  date?: Date | null;
  lieu?: string | null;
  ordreDuJour?: string | null;
  notes?: string | null;
  operationNom: string;
  societeNom: string;
}

const LIBELLE_STATUT: Record<StatutPoint, string> = {
  OUVERT: 'ouvert',
  EN_COURS: 'en cours',
  CLOS: 'clos',
};

export function dateSuisse(date: Date | null | undefined): string {
  if (!date) return '—';
  const jour = String(date.getUTCDate()).padStart(2, '0');
  const mois = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${jour}.${mois}.${date.getUTCFullYear()}`;
}

export function redigerPv(
  seance: SeancePv,
  participants: ParticipantPv[],
  points: PointPv[],
): string {
  const presents = participants.filter((p) => p.present);
  const absents = participants.filter((p) => !p.present);

  const lignes: (string | null)[] = [
    `# ${seance.numero ? `${seance.numero} — ` : ''}${seance.titre}`,
    '',
    `**Opération** : ${seance.operationNom}`,
    `**Type de séance** : ${lisible(seance.type)}`,
    `**Date** : ${dateSuisse(seance.date)}`,
    seance.lieu ? `**Lieu** : ${seance.lieu}` : null,
    '',
    '## Participants',
    '',
    ...(presents.length > 0
      ? presents.map((p) => `- ${nomComplet(p)}`)
      : ['- *aucun participant enregistré comme présent*']),
  ];

  if (absents.length > 0) {
    lignes.push('', '**Excusés**', '', ...absents.map((p) => `- ${nomComplet(p)}`));
  }

  if (seance.ordreDuJour) {
    lignes.push('', '## Ordre du jour', '', seance.ordreDuJour);
  }

  lignes.push('', '## Points traités', '');

  if (points.length === 0) {
    lignes.push('*Aucun point consigné.*');
  } else {
    for (const point of [...points].sort((a, b) => a.ordre - b.ordre)) {
      lignes.push(`### ${point.ordre}. ${point.titre}`, '');
      if (point.contenu) lignes.push(point.contenu, '');

      // Le suivi tient en une ligne, toujours au même endroit : c'est ce
      // qu'on relit trois semaines plus tard pour savoir qui devait quoi.
      const suivi = [
        `**Statut** : ${LIBELLE_STATUT[point.statut]}`,
        point.responsable ? `**Responsable** : ${point.responsable}` : null,
        point.echeance ? `**Échéance** : ${dateSuisse(point.echeance)}` : null,
      ].filter((v): v is string => v !== null);
      lignes.push(suivi.join(' · '), '');
    }
  }

  const aSuivre = points.filter((p) => p.statut !== 'CLOS');
  if (aSuivre.length > 0) {
    lignes.push(
      '## Points restant ouverts',
      '',
      ...[...aSuivre]
        .sort((a, b) => a.ordre - b.ordre)
        .map(
          (p) =>
            `- **${p.titre}** — ${p.responsable ?? 'responsable non désigné'}` +
            (p.echeance ? `, échéance ${dateSuisse(p.echeance)}` : ', sans échéance'),
        ),
      '',
    );
  }

  if (seance.notes) {
    lignes.push('## Notes', '', seance.notes, '');
  }

  lignes.push(
    '---',
    '',
    `*Procès-verbal établi par ${seance.societeNom}. ` +
      'Les remarques éventuelles sont à formuler avant la prochaine séance ; ' +
      'sans quoi le présent procès-verbal est réputé approuvé.*',
  );

  // `null` = ligne absente ; `''` = ligne vide voulue. Filtrer les chaînes
  // vides collerait tous les paragraphes les uns aux autres.
  return lignes.filter((l): l is string => l !== null).join('\n');
}

/** Nom d'un point de suivi en retard : échéance passée et point non clos. */
export function enRetard(point: PointPv, maintenant: Date): boolean {
  if (point.statut === 'CLOS' || !point.echeance) return false;
  return point.echeance.getTime() < maintenant.getTime();
}

function nomComplet(participant: ParticipantPv): string {
  return participant.organisation
    ? `${participant.nom} (${participant.organisation})`
    : participant.nom;
}

function lisible(valeur: string): string {
  return valeur.toLowerCase().replace(/_/g, ' ');
}
