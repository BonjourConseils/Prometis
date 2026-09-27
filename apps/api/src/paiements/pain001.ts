/**
 * Le fichier de paiement remis à la banque — pain.001.001.09, ISO 20022,
 * selon les Swiss Payment Standards. Module pur, testé.
 *
 * C'est le seul endroit du produit où Prometis fait **sortir de l'argent**.
 * Tout y est donc figé et vérifié avant l'écriture : un IBAN mal formé, un
 * montant nul, une référence QR fausse ne partent pas. La banque refuserait
 * le fichier entier, et l'erreur se découvrirait le jour du paiement.
 *
 * Trois types de versement, dans l'ordre où la norme suisse les nomme :
 *   · **QRR** — QR-IBAN et référence à 27 chiffres, clé de contrôle comprise.
 *   · **SCOR** — référence créancier ISO 11649 (`RF…`).
 *   · **libre** — IBAN ordinaire et communication en texte.
 */
import { estQrIban, normaliserIban } from '../appels-de-fonds/qr-facture';
import { ibanValide } from '../factures/lecture';

export { estQrIban, ibanValide };

export type TypeReference = 'QRR' | 'SCOR' | 'LIBRE';

export interface LignePaiement {
  /** Identifiant propre à la ligne, reporté à la banque puis au relevé. */
  reference: string;
  creancier: string;
  iban: string;
  montant: string;
  referenceStructuree?: string | null;
  communication?: string | null;
}

export interface OrdreAPayer {
  messageId: string;
  creeLe: Date;
  debiteur: string;
  ibanDebiteur: string;
  bicDebiteur?: string | null;
  dateExecution: Date;
  libelle?: string | null;
  lignes: LignePaiement[];
}

export class PaiementInvalide extends Error {}

const MODULO = 97n;

/** Référence QR : 27 chiffres dont le dernier est la clé (modulo 10 récursif). */
export function referenceQrValide(brut: string): boolean {
  const ref = brut.replace(/\s/g, '');
  if (!/^\d{27}$/.test(ref)) return false;
  const REPORTS = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let report = 0;
  for (const c of ref.slice(0, 26)) report = REPORTS[(report + Number(c)) % 10]!;
  return (10 - report) % 10 === Number(ref[26]);
}

/** Référence créancier ISO 11649 : `RF` + 2 chiffres de contrôle + 21 au plus. */
export function referenceScorValide(brut: string): boolean {
  const ref = brut.replace(/\s/g, '').toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(ref)) return false;
  const reordonne = ref.slice(4) + ref.slice(0, 4);
  const chiffres = [...reordonne]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join('');
  return BigInt(chiffres) % MODULO === 1n;
}

export function typeDeReference(ligne: LignePaiement): TypeReference {
  const ref = ligne.referenceStructuree?.replace(/\s/g, '');
  if (!ref) return 'LIBRE';
  if (/^\d{27}$/.test(ref)) return 'QRR';
  if (/^RF/i.test(ref)) return 'SCOR';
  return 'LIBRE';
}

const ECHAPPEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Le texte tel qu'il peut entrer dans le XML, tronqué à la longueur admise. */
function texte(valeur: string, longueur: number): string {
  return valeur
    .trim()
    .slice(0, longueur)
    .replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c]!);
}

const jour = (d: Date) => d.toISOString().slice(0, 10);
const horodatage = (d: Date) => `${d.toISOString().slice(0, 19)}`;

function montantValide(m: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(m) && Number(m) > 0;
}

/**
 * Vérifie l'ordre entier et rend la liste de ce qui cloche, en clair.
 * Vide, le fichier peut être écrit.
 */
export function verifier(ordre: OrdreAPayer): string[] {
  const erreurs: string[] = [];
  if (!ordre.lignes.length) erreurs.push('L’ordre ne contient aucune facture.');
  if (!ibanValide(ordre.ibanDebiteur)) {
    erreurs.push('Le compte de la promotion n’est pas un IBAN suisse valable.');
  }
  for (const l of ordre.lignes) {
    const ou = `${l.creancier} (${l.reference})`;
    if (!ibanValide(l.iban)) {
      erreurs.push(`${ou} : le compte du créancier n’est pas un IBAN suisse valable.`);
    }
    if (!montantValide(l.montant)) erreurs.push(`${ou} : le montant à payer manque.`);

    const type = typeDeReference(l);
    if (type === 'QRR') {
      if (!referenceQrValide(l.referenceStructuree!)) {
        erreurs.push(`${ou} : la référence QR est fausse (clé de contrôle).`);
      } else if (!estQrIban(l.iban)) {
        erreurs.push(
          `${ou} : une référence QR suppose un QR-IBAN ; ce compte est un IBAN ordinaire.`,
        );
      }
    }
    if (type === 'SCOR' && !referenceScorValide(l.referenceStructuree!)) {
      erreurs.push(`${ou} : la référence créancier est fausse (clé de contrôle).`);
    }
    if (type === 'LIBRE' && estQrIban(l.iban)) {
      erreurs.push(`${ou} : un QR-IBAN exige une référence QR, et la facture n’en porte pas.`);
    }
  }
  return erreurs;
}

export function total(lignes: LignePaiement[]): string {
  const centimes = lignes.reduce((t, l) => t + Math.round(Number(l.montant) * 100), 0);
  return (centimes / 100).toFixed(2);
}

/**
 * Le XML remis à l'e-banking. `verifier` doit être passé d'abord : ici, une
 * erreur restante lève plutôt que d'écrire un fichier que la banque refusera.
 */
export function construirePain001(ordre: OrdreAPayer): string {
  const erreurs = verifier(ordre);
  if (erreurs.length) throw new PaiementInvalide(erreurs.join(' '));

  const somme = total(ordre.lignes);
  const nb = ordre.lignes.length;
  const iban = normaliserIban;

  const transactions = ordre.lignes
    .map((l) => {
      const type = typeDeReference(l);
      const ref = l.referenceStructuree?.replace(/\s/g, '') ?? '';
      const remise =
        type === 'LIBRE'
          ? l.communication
            ? `        <RmtInf><Ustrd>${texte(l.communication, 140)}</Ustrd></RmtInf>\n`
            : ''
          : `        <RmtInf>
          <Strd>
            <CdtrRefInf>
              <Tp><CdOrPrtry>${
                type === 'QRR' ? '<Prtry>QRR</Prtry>' : '<Cd>SCOR</Cd>'
              }</CdOrPrtry></Tp>
              <Ref>${texte(ref, 35)}</Ref>
            </CdtrRefInf>
          </Strd>
        </RmtInf>\n`;
      return `      <CdtTrfTxInf>
        <PmtId><InstrId>${texte(l.reference, 35)}</InstrId><EndToEndId>${texte(l.reference, 35)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="CHF">${l.montant}</InstdAmt></Amt>
        <Cdtr><Nm>${texte(l.creancier, 70)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${iban(l.iban)}</IBAN></Id></CdtrAcct>
${remise}      </CdtTrfTxInf>`;
    })
    .join('\n');

  const agent = ordre.bicDebiteur
    ? `      <DbtrAgt><FinInstnId><BICFI>${texte(ordre.bicDebiteur, 11)}</BICFI></FinInstnId></DbtrAgt>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${texte(ordre.messageId, 35)}</MsgId>
      <CreDtTm>${horodatage(ordre.creeLe)}</CreDtTm>
      <NbOfTxs>${nb}</NbOfTxs>
      <CtrlSum>${somme}</CtrlSum>
      <InitgPty><Nm>${texte(ordre.debiteur, 70)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${texte(ordre.messageId, 35)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${nb}</NbOfTxs>
      <CtrlSum>${somme}</CtrlSum>
      <ReqdExctnDt><Dt>${jour(ordre.dateExecution)}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${texte(ordre.debiteur, 70)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${iban(ordre.ibanDebiteur)}</IBAN></Id></DbtrAcct>
${agent}${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
