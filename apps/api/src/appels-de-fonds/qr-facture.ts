/**
 * Une contrainte suisse qui se paie cher si on la découvre en production :
 * **une référence QR à 27 chiffres n'est valable qu'avec un QR-IBAN.**
 *
 * Deux familles de comptes coexistent :
 *   · le **QR-IBAN**, reconnaissable à son identifiant d'institution (les
 *     positions 5 à 9 de l'IBAN) compris entre 30000 et 31999. Lui seul
 *     accepte la référence QR — celle que `qr-reference.ts` fabrique ;
 *   · l'**IBAN ordinaire**, qui l'interdit. Une QR-facture émise avec les
 *     deux serait rejetée par la banque de l'acquéreur.
 *
 * D'où ce module, pur et testé : il décide de ce qui peut légalement figurer
 * sur la facture, plutôt que de laisser la bibliothèque lever au moment de
 * l'envoi — c'est-à-dire trop tard, l'appel de fonds étant déjà enregistré.
 */

/** Retire espaces et casse : un IBAN se saisit avec des espaces. */
export function normaliserIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Ce compte accepte-t-il une référence QR ?
 *
 * L'identifiant d'institution occupe les positions 5 à 9 d'un IBAN suisse
 * (`CH` + 2 chiffres de contrôle + 5 chiffres d'IID).
 */
export function estQrIban(iban: string | null | undefined): boolean {
  if (!iban) return false;
  const propre = normaliserIban(iban);
  if (!/^CH\d{19}$/.test(propre)) return false;
  const iid = Number(propre.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

export type ModeReference =
  { type: 'QRR'; reference: string } | { type: 'AUCUNE'; message: string; raison: string };

/**
 * Décide de la référence à porter sur la QR-facture.
 *
 * Sans QR-IBAN, on n'invente pas : la facture part **sans référence
 * structurée**, avec le numéro d'appel en message libre, et la raison est
 * remontée pour être dite à l'écran. Émettre une référence QR sur un IBAN
 * ordinaire produirait un document que la banque refuse — l'acquéreur
 * croirait avoir payé.
 */
export function choisirReference(
  iban: string | null | undefined,
  referenceQR: string | null,
  numeroAppel: string | null,
): ModeReference {
  const libelle = numeroAppel ? `Appel de fonds ${numeroAppel}` : 'Appel de fonds';

  if (!iban) {
    return {
      type: 'AUCUNE',
      message: libelle,
      raison: "La société n'a pas d'IBAN enregistré.",
    };
  }
  if (!estQrIban(iban)) {
    return {
      type: 'AUCUNE',
      message: libelle,
      raison:
        "L'IBAN de la société n'est pas un QR-IBAN : la référence QR ne peut pas y figurer. " +
        'Demander un QR-IBAN à la banque pour bénéficier du rapprochement automatique.',
    };
  }
  if (!referenceQR) {
    return { type: 'AUCUNE', message: libelle, raison: "L'appel n'a pas de référence QR." };
  }

  return { type: 'QRR', reference: referenceQR };
}

export interface Adresse {
  nom: string;
  adresse: string;
  codePostal: string;
  localite: string;
  pays: string;
}

/**
 * Ramène une adresse libre à ce qu'attend la norme.
 *
 * Le modèle ne tient qu'un champ `adresse` pour un acquéreur ; la QR-facture
 * exige rue, NPA et localité séparés. On coupe sur la dernière ligne, qui
 * porte conventionnellement « 1004 Lausanne ». Ce qui n'est pas reconnu part
 * en rue plutôt que d'être perdu.
 */
export function decouperAdresse(nom: string, libre: string | null | undefined): Adresse {
  const vide: Adresse = { nom, adresse: '', codePostal: '', localite: '', pays: 'CH' };
  if (!libre?.trim()) return vide;

  const lignes = libre
    .split(/[\n,]/)
    .map((l) => l.trim())
    .filter(Boolean);
  const derniere = lignes[lignes.length - 1] ?? '';
  const npaLocalite = /^(\d{4})\s+(.+)$/.exec(derniere);

  if (!npaLocalite) {
    return { ...vide, adresse: lignes.join(', ').slice(0, 70) };
  }

  return {
    nom,
    adresse: lignes.slice(0, -1).join(', ').slice(0, 70),
    codePostal: npaLocalite[1]!,
    localite: npaLocalite[2]!.slice(0, 35),
    pays: 'CH',
  };
}

/** Une adresse est-elle assez complète pour figurer sur une QR-facture ? */
export function adresseUtilisable(adresse: Adresse): boolean {
  return Boolean(adresse.nom && adresse.codePostal && adresse.localite);
}
