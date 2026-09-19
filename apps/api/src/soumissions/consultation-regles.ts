import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * Les règles de la consultation des entreprises — pures, testées sans base.
 *
 * Trois familles : l'accès à l'espace entreprise (lien + code), le scellé des
 * offres, et ce qui se calcule sur une offre (montant retenu, notation
 * multicritère). Le service ne fait qu'appliquer.
 */

const CENT = new Prisma.Decimal(100);
const DIX = new Prisma.Decimal(10);
const ZERO = new Prisma.Decimal(0);

// ===================================================================
//  Accès : un lien, puis un code
// ===================================================================

/** Validité d'un code envoyé par e-mail. */
export const CODE_VALIDITE_MS = 15 * 60 * 1000;
/** Au-delà, le code est brûlé : il faut en redemander un. */
export const CODE_ESSAIS_MAX = 5;
/** Durée d'une session de l'espace entreprise. */
export const SESSION_CONSULTATION = '2h';
/** La relance part trois jours avant la date limite, une seule fois. */
export const AVANCE_RELANCE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Le lien d'une invitation : 32 octets aléatoires. Il n'est **jamais**
 * stocké — seule son empreinte l'est. Une copie de la base ne rouvre aucune
 * consultation.
 */
export function genererJeton(): string {
  return randomBytes(32).toString('base64url');
}

export function empreinteJeton(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

/** Un jeton a la forme attendue — rien d'autre n'atteint la base. */
export function jetonBienForme(jeton: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(jeton);
}

export function genererCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Empreinte du code, liée à l'invitation : le même code sur une autre
 * invitation n'a pas la même empreinte.
 */
export function empreinteCode(code: string, invitationId: number, secret: string): string {
  return createHmac('sha256', secret).update(`${invitationId}:${code}`).digest('hex');
}

export function memeEmpreinte(a: string, b: string): boolean {
  const ta = Buffer.from(a);
  const tb = Buffer.from(b);
  return ta.length === tb.length && timingSafeEqual(ta, tb);
}

/**
 * Le secret des sessions de l'espace entreprise, **dérivé** de celui des
 * comptes : un jeton de session entreprise ne passe jamais pour une session
 * Prometis, et l'inverse non plus.
 */
export function secretSession(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret).update('prometis:consultation').digest('hex');
}

/** « j•••@entreprise.ch » — pour dire où le code est parti sans le révéler. */
export function masquerEmail(email: string): string {
  const [local, domaine] = email.split('@');
  if (!local || !domaine) return '•••';
  return `${local[0]}•••@${domaine}`;
}

// ===================================================================
//  Dépôt et scellé
// ===================================================================

export interface EtatSoumission {
  statut: string;
  dateLimite: Date | null;
  offresScellees: boolean;
}

/** L'entreprise peut-elle encore déposer, modifier, poser une question ? */
export function depotOuvert(
  soumission: EtatSoumission,
  invitation: { revoqueeLe: Date | null; refuseLe: Date | null },
  maintenant: Date = new Date(),
): boolean {
  if (invitation.revoqueeLe || invitation.refuseLe) return false;
  if (!['ENVOYEE', 'OUVERTE'].includes(soumission.statut)) return false;
  return soumission.dateLimite === null || soumission.dateLimite > maintenant;
}

/**
 * Une offre déposée par l'espace entreprise reste scellée jusqu'à la date
 * limite : le promoteur voit qu'elle est arrivée, pas ce qu'elle contient.
 * Une offre saisie par le promoteur n'est jamais scellée — il l'a en main.
 */
export function offreScellee(
  soumission: EtatSoumission,
  offre: { source: string },
  maintenant: Date = new Date(),
): boolean {
  if (offre.source !== 'PORTAIL' || !soumission.offresScellees) return false;
  if (!soumission.dateLimite) return false;
  return soumission.dateLimite > maintenant;
}

// ===================================================================
//  Montant retenu
// ===================================================================

export interface Ligne {
  id: number;
  type: 'OPTION' | 'VARIANTE';
  montant: Prisma.Decimal;
}

/**
 * Le montant d'une offre selon ce qu'on en retient.
 *
 * Une variante **remplace** l'offre de base ; une option s'y **ajoute**. La
 * remise s'applique au total — c'est ainsi qu'elle figure dans une offre
 * d'entreprise, sauf mention contraire.
 */
export function montantRetenu(
  offre: { montant: Prisma.Decimal | null; remisePct: Prisma.Decimal | null },
  lignes: readonly Ligne[],
  retenues: readonly number[],
): Prisma.Decimal {
  const choisies = lignes.filter((l) => retenues.includes(l.id));
  const variantes = choisies.filter((l) => l.type === 'VARIANTE');
  if (variantes.length > 1) throw new Error('Une seule variante peut être retenue.');
  const base = variantes[0]?.montant ?? offre.montant;
  if (base === null) throw new Error('Offre sans montant.');
  const brut = choisies
    .filter((l) => l.type === 'OPTION')
    .reduce((t, l) => t.plus(l.montant), base);
  return brut
    .times(CENT.minus(offre.remisePct ?? ZERO))
    .dividedBy(CENT)
    .toDecimalPlaces(2);
}

// ===================================================================
//  Notation multicritère
// ===================================================================

export interface Critere {
  id: number;
  libelle: string;
  poids: Prisma.Decimal;
  estPrix: boolean;
}

/** Les critères d'une soumission : poids positifs, somme de 100, un prix au plus. */
export function verifierCriteres(
  criteres: readonly { poids: Prisma.Decimal; estPrix: boolean }[],
): string | null {
  if (!criteres.length) return null;
  if (criteres.some((c) => c.poids.lessThanOrEqualTo(0))) return 'Chaque critère pèse plus de 0 %.';
  const total = criteres.reduce((t, c) => t.plus(c.poids), ZERO);
  if (!total.equals(CENT)) return `Les pondérations font ${total.toString()} % : il faut 100 %.`;
  if (criteres.filter((c) => c.estPrix).length > 1) return 'Un seul critère de prix.';
  return null;
}

/**
 * Note de prix sur 10 : 10 pour le moins-disant, proportionnelle ensuite
 * (moins-disant ÷ prix × 10). C'est la méthode la plus courante et la plus
 * facile à expliquer à une entreprise écartée.
 */
export function notePrix(net: Prisma.Decimal, moinsDisant: Prisma.Decimal): Prisma.Decimal {
  if (net.lessThanOrEqualTo(0)) return ZERO;
  return moinsDisant.dividedBy(net).times(DIX).toDecimalPlaces(2);
}

export interface ScoreOffre {
  offreId: number;
  /** Sur 100. `null` tant qu'un critère n'est pas noté. */
  total: Prisma.Decimal | null;
  detail: { critereId: number; note: Prisma.Decimal | null; points: Prisma.Decimal | null }[];
  manquants: number;
}

/**
 * Le score d'une offre : Σ poids × note ÷ 10, sur 100.
 *
 * Un critère non noté laisse le total **vide**, pas partiel : un total qui
 * compterait zéro pour un critère oublié déclasserait l'offre sans raison.
 */
export function scorer(
  offreId: number,
  criteres: readonly Critere[],
  notes: ReadonlyMap<number, Prisma.Decimal>,
  prix: { net: Prisma.Decimal | null; moinsDisant: Prisma.Decimal | null },
): ScoreOffre {
  let manquants = 0;
  let total = ZERO;
  const detail = criteres.map((c) => {
    const note = c.estPrix
      ? prix.net && prix.moinsDisant
        ? notePrix(prix.net, prix.moinsDisant)
        : null
      : (notes.get(c.id) ?? null);
    if (note === null) {
      manquants++;
      return { critereId: c.id, note: null, points: null };
    }
    const points = c.poids.times(note).dividedBy(DIX).toDecimalPlaces(2);
    total = total.plus(points);
    return { critereId: c.id, note, points };
  });
  return { offreId, total: manquants ? null : total.toDecimalPlaces(2), detail, manquants };
}
