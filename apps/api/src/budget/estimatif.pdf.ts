import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Le **budget estimatif**, en une page qu'on peut sortir de l'app.
 *
 * C'est le document de la décision : le promoteur le montre à son associé, à
 * sa banque, au propriétaire du terrain. Il doit donc tenir seul, sans
 * Prometis autour — d'où le rappel du foncier et des hypothèses en tête,
 * plutôt qu'un simple tableau de chiffres.
 *
 * Il dit aussi ce qu'il est : une **estimation**, à une date, sur une
 * version de budget nommée. Un chiffrage de faisabilité qu'on retrouve six
 * mois plus tard sans savoir de quand il date ni ce qu'il supposait ne vaut
 * rien — ou pire, il vaut comme s'il était vrai.
 */

export interface PosteEstimatifPdf {
  code: string;
  libelle: string;
  /** Montant propre au poste, sous-postes compris. */
  montant: number;
}

export interface FoncierPdf {
  nbParcelles: number;
  communes: string[];
  surfaceM2: number;
  /** Surface brute de plancher constructible. */
  sbpM2: number;
  prix: number;
  fraisAcquisition: number;
  /** Les frais sont estimés au taux du canton, pas saisis. */
  fraisEstimes: boolean;
}

export interface DonneesEstimatif {
  societe: string;
  operation: string;
  version: string;
  dateEdition: Date;
  foncier: FoncierPdf | null;
  postes: PosteEstimatifPdf[];
  totalCouts: number;
  /** Total des ventes attendu. `null` quand il n'a pas été saisi. */
  recettes: number | null;
}

/** « 1 130 000.00 » — espace fine insécable, pour que le nombre ne se coupe pas. */
export function montantSuisse(valeur: number): string {
  const [entiere, decimales = '00'] = valeur.toFixed(2).split('.');
  return `${entiere!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${decimales}`;
}

@Injectable()
export class EstimatifPdfService {
  async generer(d: DonneesEstimatif): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', margin: 56 });
    const morceaux: Buffer[] = [];
    document.on('data', (m: Buffer) => morceaux.push(m));
    const termine = new Promise<void>((resoudre) => document.on('end', () => resoudre()));

    const GAUCHE = 56;
    const DROITE = 539; // 595 - 56
    const LARGEUR = DROITE - GAUCHE;

    const ligne = (texte: string, taille = 10.5, gras = false) =>
      document
        .font(gras ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(taille)
        .text(texte, GAUCHE, document.y, { width: LARGEUR });

    /** Une ligne libellé à gauche, montant aligné à droite. */
    const ligneChiffree = (libelle: string, montant: string, gras = false) => {
      const y = document.y;
      document
        .font(gras ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10.5)
        .text(libelle, GAUCHE, y, { width: LARGEUR - 110 });
      document.text(montant, DROITE - 110, y, { width: 110, align: 'right' });
      document.y = Math.max(document.y, y + 14);
    };

    const filet = () => {
      document
        .moveTo(GAUCHE, document.y + 3)
        .lineTo(DROITE, document.y + 3)
        .lineWidth(0.5)
        .strokeColor('#b8c4cc')
        .stroke();
      document.y += 10;
    };

    // --- En-tête ---
    ligne(d.societe, 9);
    document.moveDown(0.8);
    ligne('Budget estimatif', 18, true);
    ligne(d.operation, 13);
    document.moveDown(0.3);
    ligne(
      `Version « ${d.version} » · établi le ${d.dateEdition.toLocaleDateString('fr-CH')}`,
      9,
    );
    document.moveDown(1.2);
    filet();

    // --- Le terrain ---
    // Il vient en premier parce que c'est la seule donnée déjà certaine à ce
    // stade : les parcelles sont saisies, leur prix est négocié ou connu.
    if (d.foncier && d.foncier.nbParcelles > 0) {
      const f = d.foncier;
      ligne('Le terrain', 12, true);
      document.moveDown(0.4);
      const ou = f.communes.length ? ` — ${f.communes.join(', ')}` : '';
      ligne(
        `${f.nbParcelles} parcelle${f.nbParcelles > 1 ? 's' : ''}${ou} · ` +
          `${montantSuisse(f.surfaceM2)} m² de terrain` +
          (f.sbpM2 > 0 ? ` · ${montantSuisse(f.sbpM2)} m² de plancher constructible` : ''),
        9.5,
      );
      document.moveDown(0.5);
      ligneChiffree('Achat du terrain', montantSuisse(f.prix));
      if (f.fraisAcquisition > 0) {
        ligneChiffree(
          `Frais d'acquisition${f.fraisEstimes ? ' (estimés)' : ''}`,
          `${f.fraisEstimes ? '≈ ' : ''}${montantSuisse(f.fraisAcquisition)}`,
        );
      }
      if (f.sbpM2 > 0 && f.surfaceM2 > 0) {
        // Hors frais, comme sur l'écran Foncier : ici on dit ce qu'on paie
        // le sol. Notaire et droits de mutation sont un poste de coût, et
        // ils figurent déjà deux lignes plus haut.
        document.moveDown(0.2);
        ligne(
          `Soit ${montantSuisse(f.prix / f.surfaceM2)} par m² de terrain et ` +
            `${montantSuisse(f.prix / f.sbpM2)} par m² de plancher constructible, hors frais — ` +
            `le second est celui qui se compare au prix de vente au m².`,
          9,
        );
      }
      document.moveDown(1);
      filet();
    }

    // --- Les coûts, grand poste par grand poste ---
    ligne('Coûts estimés', 12, true);
    document.moveDown(0.5);
    if (d.postes.length === 0) {
      ligne('Aucun poste chiffré.', 9.5);
    } else {
      for (const p of d.postes) {
        ligneChiffree(`${p.code}  ${p.libelle}`, montantSuisse(p.montant));
      }
    }
    document.moveDown(0.3);
    filet();
    ligneChiffree('Total des coûts', montantSuisse(d.totalCouts), true);
    document.moveDown(1);

    // --- Le verdict ---
    filet();
    if (d.recettes === null) {
      ligne(
        'Total des ventes attendu : non renseigné. Sans lui, le bénéfice ne se calcule pas.',
        10,
      );
    } else {
      ligneChiffree('Total des ventes attendu', montantSuisse(d.recettes));
      const benefice = d.recettes - d.totalCouts;
      ligneChiffree('Bénéfice prévisionnel', montantSuisse(benefice), true);
      if (d.recettes > 0) {
        document.moveDown(0.2);
        ligne(
          `Marge : ${((benefice / d.recettes) * 100).toFixed(1)} % des ventes` +
            (d.totalCouts > 0
              ? ` · ${((benefice / d.totalCouts) * 100).toFixed(1)} % des coûts`
              : ''),
          9.5,
        );
      }
    }

    // --- Ce que ce document n'est pas ---
    document.moveDown(2);
    document.font('Helvetica').fontSize(8).fillColor('#5a6b78');
    document.text(
      "Chiffrage de faisabilité. Les montants sont des estimations par grand poste CFC, hors " +
        "taxe, établies avant toute soumission d'entreprise. Ils seront remplacés poste par " +
        'poste par les montants adjugés au fil du chantier.',
      GAUCHE,
      document.y,
      { width: LARGEUR },
    );
    document.fillColor('black');

    document.end();
    await termine;
    return Buffer.concat(morceaux);
  }
}
