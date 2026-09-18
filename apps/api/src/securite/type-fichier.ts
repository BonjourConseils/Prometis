/**
 * Le vrai type d'un fichier, lu dans ses octets.
 *
 * Le type MIME d'un envoi vient du navigateur, qui le déduit de l'extension —
 * c'est-à-dire du nom que l'utilisateur, ou quelqu'un d'autre, a choisi. Il se
 * falsifie en renommant un fichier. Le réémettre au téléchargement, comme le
 * faisait la GED, revient à laisser l'expéditeur décider de la façon dont
 * l'application servira son contenu.
 *
 * On lit donc la **signature** en tête du fichier, on la compare à une liste
 * blanche, et c'est le type **détecté** qu'on enregistre. Tout ce qui n'est
 * pas reconnu est refusé : on n'accepte pas « à peu près un PDF ».
 */

export interface TypeDetecte {
  mime: string;
  /** Libellé pour le message d'erreur et l'écran. */
  libelle: string;
}

export type Famille = 'document' | 'facture';

/** Ce qu'une GED de promotion reçoit réellement : pièces, plans, photos de chantier. */
const EXTENSIONS_OOXML: Record<string, TypeDetecte> = {
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    libelle: 'Word',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    libelle: 'Excel',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    libelle: 'PowerPoint',
  },
  odt: { mime: 'application/vnd.oasis.opendocument.text', libelle: 'OpenDocument texte' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', libelle: 'OpenDocument tableur' },
};

const EXTENSIONS_CFB: Record<string, TypeDetecte> = {
  doc: { mime: 'application/msword', libelle: 'Word 97-2003' },
  xls: { mime: 'application/vnd.ms-excel', libelle: 'Excel 97-2003' },
  msg: { mime: 'application/vnd.ms-outlook', libelle: 'message Outlook' },
};

const TEXTE: Record<string, TypeDetecte> = {
  txt: { mime: 'text/plain; charset=utf-8', libelle: 'texte' },
  md: { mime: 'text/markdown; charset=utf-8', libelle: 'Markdown' },
  csv: { mime: 'text/csv; charset=utf-8', libelle: 'CSV' },
  dxf: { mime: 'image/vnd.dxf', libelle: 'plan DXF' },
  ifc: { mime: 'application/x-step', libelle: 'maquette IFC' },
};

function commencePar(octets: Buffer, signature: number[], decalage = 0): boolean {
  if (octets.length < decalage + signature.length) return false;
  return signature.every((b, i) => octets[decalage + i] === b);
}

function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.');
  return point === -1 ? '' : nom.slice(point + 1).toLowerCase();
}

/**
 * Un texte acceptable : de l'UTF-8 sans octet nul, et **sans balisage
 * exécutable**. Un fichier `.txt` qui contient `<svg onload=…>` est un SVG qui
 * a changé de nom.
 */
function estTexteSur(octets: Buffer): boolean {
  const echantillon = octets.subarray(0, 64 * 1024);
  if (echantillon.includes(0)) return false;
  const texte = echantillon.toString('utf8');
  if (texte.includes('�')) return false;
  return !/<\s*(script|svg|html|iframe|object|embed)\b/i.test(texte);
}

/** Détecte le type, ou `null` s'il n'est pas dans la liste blanche. */
export function detecterType(octets: Buffer, nomOriginal: string): TypeDetecte | null {
  const ext = extensionDe(nomOriginal);

  if (commencePar(octets, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { mime: 'application/pdf', libelle: 'PDF' };
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', libelle: 'JPEG' };
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: 'image/png', libelle: 'PNG' };
  if (commencePar(octets, [0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', libelle: 'GIF' };
  if (
    commencePar(octets, [0x52, 0x49, 0x46, 0x46]) &&
    commencePar(octets, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: 'image/webp', libelle: 'WebP' };
  }
  if (
    commencePar(octets, [0x49, 0x49, 0x2a, 0x00]) ||
    commencePar(octets, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { mime: 'image/tiff', libelle: 'TIFF' };
  }
  // HEIC : les photos de chantier prises à l'iPhone. `ftyp` au 5e octet, puis la marque.
  if (commencePar(octets, [0x66, 0x74, 0x79, 0x70], 4)) {
    const marque = octets.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'mif1', 'msf1'].includes(marque))
      return { mime: 'image/heic', libelle: 'HEIC' };
    return null;
  }
  // DWG : « AC10xx ». Le format natif des plans d'architecte.
  if (commencePar(octets, [0x41, 0x43, 0x31, 0x30]))
    return { mime: 'image/vnd.dwg', libelle: 'plan DWG' };

  // Un ZIP n'est accepté que s'il est un document bureautique : une archive
  // quelconque arriverait sans que rien n'ait pu en vérifier le contenu.
  if (commencePar(octets, [0x50, 0x4b, 0x03, 0x04])) return EXTENSIONS_OOXML[ext] ?? null;
  if (commencePar(octets, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return EXTENSIONS_CFB[ext] ?? null;

  if (TEXTE[ext] && estTexteSur(octets)) return TEXTE[ext]!;
  return null;
}

/** Ce qu'une facture peut être : une pièce ou un scan, rien d'autre. */
const FACTURE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']);

export function typeAccepte(
  octets: Buffer,
  nomOriginal: string,
  famille: Famille,
): { ok: true; type: TypeDetecte } | { ok: false; raison: string } {
  const type = detecterType(octets, nomOriginal);
  if (!type) {
    return {
      ok: false,
      raison:
        `« ${nomOriginal} » n'est pas un type de fichier accepté. Formats reçus : PDF, images ` +
        `(JPEG, PNG, WebP, TIFF, HEIC), plans (DWG, DXF, IFC), documents bureautiques ` +
        `(Word, Excel, PowerPoint, OpenDocument), texte. Une archive ZIP se dépose fichier par fichier.`,
    };
  }
  if (famille === 'facture' && !FACTURE.has(type.mime)) {
    return {
      ok: false,
      raison: `Une facture se dépose en PDF ou en image scannée — « ${nomOriginal} » est un fichier ${type.libelle}.`,
    };
  }
  return { ok: true, type };
}
