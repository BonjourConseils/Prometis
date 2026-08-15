import { Injectable, Logger } from '@nestjs/common';
import { SwissQRBill } from 'swissqrbill/pdf';
import PDFDocument from 'pdfkit';
import {
  adresseUtilisable,
  choisirReference,
  decouperAdresse,
  normaliserIban,
  type ModeReference,
} from './qr-facture';

export interface DonneesQrFacture {
  montant: number;
  numero: string | null;
  referenceQR: string | null;
  lot: string;
  etapeLibelle: string;
  dateEcheance: Date;
  societe: {
    raisonSociale: string;
    iban: string | null;
    adresse: string | null;
    codePostal: string | null;
    localite: string | null;
  };
  acquereur: { nom: string; adresse: string | null };
}

export interface ResultatQrFacture {
  pdf: Buffer;
  reference: ModeReference;
}

/**
 * Génération de la QR-facture suisse en PDF.
 *
 * Bibliothèque plutôt que service : rien ne sort du serveur, il n'y a donc
 * aucune question d'hébergement des données — c'est ce qui distingue ce point
 * du choix d'un service d'OCR.
 *
 * La page porte le détail lisible de l'appel au-dessus, et la partie
 * paiement normalisée en bas. Un acquéreur reçoit ainsi un seul document :
 * ce qu'il doit, pourquoi, et de quoi le payer.
 */
@Injectable()
export class QrFactureService {
  private readonly logger = new Logger(QrFactureService.name);

  /** Renvoie `null` si les données ne permettent pas une facture valable. */
  async generer(donnees: DonneesQrFacture): Promise<ResultatQrFacture | null> {
    const creancier = decouperAdresse(
      donnees.societe.raisonSociale,
      [
        donnees.societe.adresse,
        [donnees.societe.codePostal, donnees.societe.localite].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join('\n'),
    );

    if (!donnees.societe.iban || !adresseUtilisable(creancier)) {
      // Sans IBAN ni adresse complète, la partie paiement serait invalide.
      // Mieux vaut pas de pièce jointe qu'une pièce que la banque refuse.
      this.logger.warn(
        `QR-facture non générée : IBAN ou adresse de la société incomplets ` +
          `(lot ${donnees.lot}).`,
      );
      return null;
    }

    const reference = choisirReference(donnees.societe.iban, donnees.referenceQR, donnees.numero);
    const debiteur = decouperAdresse(donnees.acquereur.nom, donnees.acquereur.adresse);

    const facture = new SwissQRBill({
      currency: 'CHF',
      amount: donnees.montant,
      creditor: {
        account: normaliserIban(donnees.societe.iban),
        name: creancier.nom.slice(0, 70),
        address: creancier.adresse || creancier.localite,
        zip: creancier.codePostal,
        city: creancier.localite,
        country: creancier.pays,
      },
      // Le débiteur est facultatif dans la norme : sans adresse exploitable,
      // la facture part avec la zone laissée à remplir à la main plutôt
      // qu'avec une adresse inventée.
      ...(adresseUtilisable(debiteur)
        ? {
            debtor: {
              name: debiteur.nom.slice(0, 70),
              address: debiteur.adresse || debiteur.localite,
              zip: debiteur.codePostal,
              city: debiteur.localite,
              country: debiteur.pays,
            },
          }
        : {}),
      ...(reference.type === 'QRR'
        ? { reference: reference.reference }
        : { message: reference.message }),
    });

    const document = new PDFDocument({ size: 'A4', margin: 50 });
    const morceaux: Buffer[] = [];
    document.on('data', (m: Buffer) => morceaux.push(m));
    const termine = new Promise<void>((resoudre) => document.on('end', () => resoudre()));

    this.entete(document, donnees, reference);
    facture.attachTo(document);
    document.end();
    await termine;

    return { pdf: Buffer.concat(morceaux), reference };
  }

  private entete(
    document: PDFKit.PDFDocument,
    donnees: DonneesQrFacture,
    reference: ModeReference,
  ): void {
    const ligne = (texte: string, taille = 10, gras = false) => {
      document
        .font(gras ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(taille)
        .text(texte);
    };

    ligne(donnees.societe.raisonSociale, 14, true);
    ligne(
      [
        donnees.societe.adresse,
        [donnees.societe.codePostal, donnees.societe.localite].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(' · '),
      9,
    );
    document.moveDown(2);

    ligne(`Appel de fonds ${donnees.numero ?? ''}`.trim(), 16, true);
    document.moveDown(0.5);
    ligne(`Lot ${donnees.lot}`);
    ligne(`Étape : ${donnees.etapeLibelle}`);
    ligne(`Échéance : ${donnees.dateEcheance.toLocaleDateString('fr-CH')}`);
    document.moveDown(0.5);
    ligne(`Montant dû : ${donnees.montant.toFixed(2)} CHF`, 12, true);

    if (reference.type === 'AUCUNE') {
      document.moveDown(1);
      // Dit sur la facture, pas seulement dans les journaux : c'est
      // l'acquéreur qui devra rappeler la référence à la main.
      ligne(
        'Sans référence structurée — merci de rappeler le numéro ci-dessus lors du versement.',
        9,
      );
    }

    document.moveDown(2);
  }
}
