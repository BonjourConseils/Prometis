import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature HMAC-SHA256 des webhooks, dans les deux sens.
 *
 * Kolabimo → Prometis et Prometis → Kolabimo emploient le même format, pour
 * qu'une seule implémentation soit à relire, et une seule à corriger.
 *
 * Format de l'en-tête : `t=<horodatage unix>,v1=<hmac hexadécimal>`
 *
 * L'horodatage est **dans** le message signé (`<t>.<corps>`) et pas seulement
 * à côté : sinon on pourrait rejouer une signature valide en changeant la date
 * pour la faire rentrer dans la fenêtre de tolérance.
 */

export const ENTETE_SIGNATURE = 'x-kolabimo-signature';
export const ENTETE_CLE_API = 'x-api-key';

/**
 * Fenêtre d'acceptation d'un horodatage, en secondes.
 *
 * Elle borne le rejeu d'une requête interceptée. Cinq minutes absorbent la
 * dérive d'horloge entre deux serveurs sans ouvrir une fenêtre confortable.
 */
export const TOLERANCE_SECONDES = 300;

const VERSION = 'v1';

export function signer(secret: string, corpsBrut: string, horodatage: Date = new Date()): string {
  const t = Math.floor(horodatage.getTime() / 1000);
  return `t=${t},${VERSION}=${empreinte(secret, t, corpsBrut)}`;
}

export type ResultatVerification = { valide: true } | { valide: false; raison: string };

export function verifier(options: {
  secret: string;
  corpsBrut: string;
  entete: string | undefined;
  maintenant?: Date;
  toleranceSecondes?: number;
}): ResultatVerification {
  const { secret, corpsBrut, entete } = options;
  const maintenant = options.maintenant ?? new Date();
  const tolerance = options.toleranceSecondes ?? TOLERANCE_SECONDES;

  if (!entete) return { valide: false, raison: `En-tête ${ENTETE_SIGNATURE} absent.` };
  if (!secret) return { valide: false, raison: 'Aucun secret de signature.' };

  const champs = new Map<string, string>();
  for (const morceau of entete.split(',')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;
    champs.set(morceau.slice(0, separateur).trim(), morceau.slice(separateur + 1).trim());
  }

  const t = Number(champs.get('t'));
  const signature = champs.get(VERSION);
  if (!Number.isInteger(t) || !signature) {
    return { valide: false, raison: 'Signature malformée : « t=…,v1=… » attendu.' };
  }

  const ecart = Math.abs(Math.floor(maintenant.getTime() / 1000) - t);
  if (ecart > tolerance) {
    return { valide: false, raison: `Horodatage hors tolérance (${ecart} s > ${tolerance} s).` };
  }

  // Comparaison à temps constant : une comparaison naïve fuit, caractère par
  // caractère, de quoi reconstruire une signature valide par essais successifs.
  if (!egalesEnTempsConstant(signature, empreinte(secret, t, corpsBrut))) {
    return { valide: false, raison: 'Signature invalide.' };
  }

  return { valide: true };
}

function empreinte(secret: string, t: number, corpsBrut: string): string {
  return createHmac('sha256', secret).update(`${t}.${corpsBrut}`).digest('hex');
}

function egalesEnTempsConstant(a: string, b: string): boolean {
  const tamponA = Buffer.from(a, 'utf8');
  const tamponB = Buffer.from(b, 'utf8');
  // `timingSafeEqual` lève si les longueurs diffèrent — ce que la longueur
  // révèle déjà, donc la sortie anticipée n'apprend rien de plus.
  if (tamponA.length !== tamponB.length) return false;
  return timingSafeEqual(tamponA, tamponB);
}

/**
 * Clé de dédoublonnage d'un événement.
 *
 * Elle est portée par une contrainte d'unicité en base : c'est elle qui rend
 * un rejeu inoffensif. Deux cas :
 *
 *   · l'émetteur fournit un identifiant d'événement → la clé en dérive, et
 *     deux livraisons du *même* événement se dédoublonnent même si la charge
 *     a été re-sérialisée différemment ;
 *   · il n'en fournit pas → on retombe sur l'empreinte du corps. Un rejeu
 *     à l'octet près est alors ignoré, mais deux événements distincts de
 *     charge identique le seraient aussi. D'où le premier cas, à préférer.
 */
export function construireDedupeKey(options: {
  source: string;
  evenement: string;
  idEvenement?: string | null;
  corpsBrut?: string;
}): string {
  const { source, evenement, idEvenement, corpsBrut } = options;
  const discriminant = idEvenement
    ? idEvenement
    : `sha256:${createHash('sha256')
        .update(corpsBrut ?? '')
        .digest('hex')
        .slice(0, 32)}`;
  return `${source}:${evenement}:${discriminant}`;
}
