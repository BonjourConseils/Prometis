import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formaterReferenceQR } from './qr-reference';

export interface DestinataireLettre {
  nom: string;
  adresse: string | null;
  npa?: string | null;
  localite?: string | null;
  /** Rôle dans le dossier — « ACQUEREUR », « CONJOINT », « REPRESENTANT »… */
  role?: string | null;
  /** Quote-part en fraction, telle qu'elle figure à l'acte : « 1/2 ». */
  quotePart?: string | null;
}

export interface DonneesLettre {
  numero: string;
  lot: string;
  etapeLibelle: string;
  montant: string;
  dateEmission: Date;
  dateEcheance: Date;
  referenceQR: string | null;
  societe: {
    raisonSociale: string;
    adresse: string | null;
    codePostal: string | null;
    localite: string | null;
    iban: string | null;
  };
  destinataires: DestinataireLettre[];
}

/**
 * La **lettre à l'acquéreur** — le premier des deux documents d'un appel.
 *
 * Elle existe parce que l'appel de fonds s'adresse à deux lecteurs qui n'ont
 * pas le même besoin. L'acquéreur veut savoir ce qui a été construit, ce
 * qu'il doit, et quoi faire ; sa banque, qui paie le plus souvent à sa place,
 * veut un bordereau qu'elle puisse traiter sans le lire. Un seul document
 * obligeait l'un des deux à s'accommoder de l'autre — en pratique,
 * l'acquéreur recevait une facture et devait deviner qu'il fallait la faire
 * suivre.
 *
 * La lettre porte donc l'explication, et le renvoi explicite au bordereau.
 * Elle ne porte **pas** de partie paiement : deux documents scannables pour
 * une seule créance, c'est un double versement qui attend son heure.
 */
@Injectable()
export class LettreAcquereurService {
  async generer(donnees: DonneesLettre): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', margin: 60 });
    const morceaux: Buffer[] = [];
    document.on('data', (m: Buffer) => morceaux.push(m));
    const termine = new Promise<void>((resoudre) => document.on('end', () => resoudre()));

    const ligne = (texte: string, taille = 10.5, gras = false) => {
      document
        .font(gras ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(taille)
        .text(texte, { align: 'left' });
    };

    // --- Expéditeur ---
    ligne(donnees.societe.raisonSociale, 13, true);
    const adresseSociete = [
      donnees.societe.adresse,
      [donnees.societe.codePostal, donnees.societe.localite].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(' · ');
    if (adresseSociete) ligne(adresseSociete, 9);

    // --- Destinataires : tous, pas seulement le premier ---
    document.moveDown(3);
    for (const personne of donnees.destinataires) {
      ligne(personne.nom, 10.5, true);
      if (personne.adresse) ligne(personne.adresse);
      const localite = [personne.npa, personne.localite].filter(Boolean).join(' ');
      if (localite) ligne(localite);
      // La quote-part est dite, jamais appliquée au montant : les appels de
      // fonds sont **solidaires**. Chacun reçoit la totalité de la créance.
      if (personne.quotePart) ligne(`Quote-part ${personne.quotePart}`, 9);
      document.moveDown(0.6);
    }

    document.moveDown(1.5);
    ligne(
      `${donnees.societe.localite ?? ''}, le ${donnees.dateEmission.toLocaleDateString('fr-CH')}`.replace(
        /^, /,
        '',
      ),
      10,
    );

    document.moveDown(2);
    ligne(`Appel de fonds ${donnees.numero} — lot ${donnees.lot}`, 14, true);

    document.moveDown(1.5);
    ligne(donnees.destinataires.length > 1 ? 'Madame, Monsieur,' : 'Madame, Monsieur,');
    document.moveDown(1);

    ligne(
      `L'étape « ${donnees.etapeLibelle} » de votre promotion est achevée. ` +
        `Conformément à l'échéancier annexé à votre acte de vente, la tranche ` +
        `correspondante devient exigible.`,
    );
    document.moveDown(1);

    ligne(`Montant dû : ${donnees.montant} CHF`, 12, true);
    ligne(`Lot : ${donnees.lot}`);
    ligne(`Échéance : ${donnees.dateEcheance.toLocaleDateString('fr-CH')}`);
    if (donnees.referenceQR) {
      ligne(`Référence : ${formaterReferenceQR(donnees.referenceQR)}`);
    }

    document.moveDown(1.5);
    // Le paragraphe qui justifie l'existence de ce document.
    ligne(
      `Un bordereau de versement avec QR-facture accompagne ce courrier. ` +
        `Si votre acquisition est financée par un prêt hypothécaire, ` +
        `merci de transmettre ce bordereau à votre établissement bancaire : ` +
        `c'est lui qui procédera au versement. Dans le cas contraire, il vous ` +
        `permet de payer depuis votre application bancaire ou au guichet.`,
    );

    document.moveDown(1);
    ligne(
      `Merci de conserver la référence indiquée : elle affecte automatiquement ` +
        `votre versement à votre lot.`,
    );

    if (donnees.destinataires.length > 1) {
      document.moveDown(1);
      ligne(
        `Ce courrier est adressé à l'ensemble des acquéreurs du dossier. ` +
          `La créance est solidaire : un seul versement du montant total la solde.`,
        9.5,
      );
    }

    document.moveDown(2.5);
    ligne('Avec nos salutations distinguées,');
    document.moveDown(2);
    ligne(donnees.societe.raisonSociale, 10.5, true);

    document.end();
    await termine;
    return Buffer.concat(morceaux);
  }
}
