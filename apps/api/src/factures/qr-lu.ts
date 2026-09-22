/**
 * Le bulletin QR suisse (norme SIX 2.x) lu sur une facture reçue — module pur.
 *
 * Ce contenu n'est pas une interprétation : l'émetteur y a écrit lui-même son
 * nom, son compte, le montant et la référence. Il fait donc foi sur la lecture
 * de l'IA, et vaut même quand le texte manque (photo sans OCR, créancier qui
 * n'apparaît qu'en logo). Repris de Kourtagimo, qui l'a éprouvé sur des
 * factures réelles, en corrigeant l'adresse combinée (type K) et la date
 * d'échéance.
 *
 * Aucune dépendance, aucun accès réseau.
 */

export interface BulletinQr {
  /** Le créancier : c'est l'ÉMETTEUR de la facture, jamais le débiteur. */
  creancier: string;
  creancierAdresse: string | null;
  creancierLocalite: string | null;
  iban: string;
  /** Montant à payer — net de retenue et d'acomptes, pas forcément le TTC. */
  montant: number | null;
  monnaie: 'CHF' | 'EUR';
  debiteur: string | null;
  typeReference: 'QRR' | 'SCOR' | 'NON';
  reference: string | null;
  message: string | null;
  /** Informations de facturation Swico (`//S1/`), quand l'émetteur les a mises. */
  numero: string | null;
  dateFacture: string | null;
  ide: string | null;
  /** Échéance calculée depuis la date de facture et la condition de paiement (étiquette 40). */
  dateEcheance: string | null;
}

/** L'ordre des lignes EST la spécification (SIX IG QR-bill, § 4.3.3). */
const L = {
  entete: 0,
  version: 1,
  iban: 3,
  creancierType: 4,
  creancierNom: 5,
  creancierRue: 6,
  creancierNumero: 7,
  creancierNpa: 8,
  creancierLieu: 9,
  montant: 18,
  monnaie: 19,
  debiteurNom: 21,
  typeReference: 27,
  reference: 28,
  message: 29,
} as const;

const net = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** AAMMJJ → AAAA-MM-JJ, si c'est une date qui existe. */
function dateSwico(v: string | undefined): string | null {
  if (!v || !/^\d{6}$/.test(v)) return null;
  const iso = `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * `//S1/10/4821/11/260910/30/123456789/32/8.1/40/0:30` — étiquettes Swico
 * suivies de leur valeur. Une barre oblique dans une valeur s'écrit `\/`.
 */
export function lireInfosFacturation(brut: string | null): {
  numero: string | null;
  dateFacture: string | null;
  ide: string | null;
  dateEcheance: string | null;
} {
  const vide = { numero: null, dateFacture: null, ide: null, dateEcheance: null };
  if (!brut?.startsWith('//S1/')) return vide;
  const morceaux = brut
    .slice(5)
    .replace(/\\\//g, '\uE000')
    .split('/')
    .map((m) => m.replace(/\uE000/g, '/'));
  const champs = new Map<string, string>();
  for (let i = 0; i + 1 < morceaux.length; i += 2) champs.set(morceaux[i]!, morceaux[i + 1]!);

  // L'étiquette 11 peut être une date (AAMMJJ) ou une période (AAMMJJAAMMJJ) :
  // pour une période, c'est la date de début qui date la facture.
  const d11 = champs.get('11');
  const dateFacture = dateSwico(d11?.slice(0, 6));

  const tva = champs.get('30')?.replace(/\D/g, '');
  const ide =
    tva && tva.length === 9 ? `CHE-${tva.slice(0, 3)}.${tva.slice(3, 6)}.${tva.slice(6)}` : null;

  // Étiquette 40 : « 0:30 » = 0 % d'escompte à 30 jours, soit le délai net.
  // Plusieurs conditions se séparent par « ; » : la plus longue est le net.
  let dateEcheance: string | null = null;
  const conditions = champs.get('40');
  if (dateFacture && conditions) {
    const jours = conditions
      .split(';')
      .map((c) => Number(c.split(':')[1]))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
    if (jours.length) {
      const d = new Date(`${dateFacture}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Math.max(...jours));
      dateEcheance = d.toISOString().slice(0, 10);
    }
  }

  return { numero: net(champs.get('10')), dateFacture, ide, dateEcheance };
}

/**
 * Le contenu d'un QR code → bulletin, ou `null` si ce n'est pas un bulletin
 * QR suisse valable. Un code quelconque sur une facture (un lien, un code
 * produit) ne doit rien affirmer.
 */
export function lireBulletinQr(contenu: string): BulletinQr | null {
  const l = contenu.split(/\r\n|\n|\r/);
  if (l[L.entete]?.trim() !== 'SPC' || !/^02\d\d$/.test(l[L.version]?.trim() ?? '')) return null;

  const iban = net(l[L.iban])?.replace(/\s/g, '').toUpperCase();
  const creancier = net(l[L.creancierNom]);
  if (!iban || !/^(CH|LI)\d{7}[A-Z0-9]{12}$/.test(iban) || !creancier) return null;

  const monnaie = net(l[L.monnaie]);
  if (monnaie !== 'CHF' && monnaie !== 'EUR') return null;
  const montantBrut = net(l[L.montant]);
  const montant = montantBrut && /^\d+(\.\d{1,2})?$/.test(montantBrut) ? Number(montantBrut) : null;

  const typeRef = net(l[L.typeReference]);
  if (typeRef !== 'QRR' && typeRef !== 'SCOR' && typeRef !== 'NON') return null;

  // Type S : rue, numéro, NPA, lieu sur quatre lignes. Type K (combiné,
  // abandonné par la norme mais encore émis) : deux lignes libres, la
  // seconde portant « NPA lieu ».
  const combinee = net(l[L.creancierType]) === 'K';
  const creancierAdresse = combinee
    ? net(l[L.creancierRue])
    : [net(l[L.creancierRue]), net(l[L.creancierNumero])].filter(Boolean).join(' ') || null;
  const creancierLocalite = combinee
    ? net(l[L.creancierNumero])
    : [net(l[L.creancierNpa]), net(l[L.creancierLieu])].filter(Boolean).join(' ') || null;

  // Les informations de facturation suivent « EPD », à un rang qui varie
  // selon les champs facultatifs : on les repère à leur préfixe.
  const infos = lireInfosFacturation(
    l.map((x) => x.trim()).find((x) => x.startsWith('//')) ?? null,
  );

  return {
    creancier,
    creancierAdresse,
    creancierLocalite,
    iban,
    montant,
    monnaie,
    debiteur: net(l[L.debiteurNom]),
    typeReference: typeRef,
    reference: typeRef === 'NON' ? null : (net(l[L.reference])?.replace(/\s/g, '') ?? null),
    message: net(l[L.message]),
    ...infos,
  };
}
