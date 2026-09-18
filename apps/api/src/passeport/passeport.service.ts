import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentCategorie, EquipementCategorie } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { zipSync } from 'fflate';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { IaService } from '../ia/ia.service';
import { masquer } from '../ia/fournisseur';
import { OcrService } from '../factures/ocr.service';
import { StockageService } from '../stockage/stockage.service';
import { PIECES_ATTENDUES, calculerEcheances } from './echeances';
import {
  SYSTEME,
  filtrerParCitation,
  finGarantie,
  messageUtilisateur,
  schemaJson,
  schemaReponse,
} from './extraction';

/** Les catégories de la GED qui composent le dossier de l'ouvrage. */
export const CATEGORIES_PASSEPORT: DocumentCategorie[] = [
  'PV_RECEPTION',
  'PLAN',
  'PERMIS',
  'AUTORISATION',
  'NOTICE',
  'GARANTIE',
  'CERTIFICAT',
  'CONTRAT_ENTRETIEN',
  'ASSURANCE',
  'PPE_ACTE_CONSTITUTIF',
  'PPE_REGLEMENT',
  'PPE_PLAN',
];

export interface DonneesEquipement {
  categorie: EquipementCategorie;
  designation: string;
  marque?: string | null;
  modele?: string | null;
  numeroSerie?: string | null;
  emplacement?: string | null;
  bienId?: number | null;
  lotId?: number | null;
  entrepriseId?: number | null;
  contratId?: number | null;
  cfcNodeId?: number | null;
  dateMiseEnService?: Date | null;
  garantieFabricantFin?: Date | null;
  entretienPeriodiciteMois?: number | null;
  dernierEntretien?: Date | null;
  notes?: string | null;
}

/**
 * Le passeport numérique de l'ouvrage.
 *
 * Il commence quand le chantier finit, et il sert à d'autres que le promoteur
 * — acquéreurs, PPE, régie, prochain acheteur. D'où trois choix :
 *
 *   · il **se nourrit de l'existant** : garanties calculées depuis les
 *     contrats réceptionnés, pièces tirées de la GED. Rien n'est ressaisi ;
 *   · il **s'exporte** en un dossier autonome — une archive qu'on remet à la
 *     PPE et qui se lit sans Prometis ;
 *   · il **reste lisible après résiliation** du module : c'est le document
 *     dont on a besoin dix ans plus tard, pas pendant l'abonnement.
 */
@Injectable()
export class PasseportService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly ia: IaService,
    private readonly ocr: OcrService,
    private readonly stockage: StockageService,
  ) {}

  async synthese(operationId: number) {
    const donnees = await this.db.run(async (tx) => {
      const operation = await tx.operation.findUnique({
        where: { id: operationId },
        select: { id: true, nom: true, commune: true },
      });
      if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);

      const [equipements, propositions, contrats, documents] = await Promise.all([
        tx.equipement.findMany({
          where: { operationId, statut: 'VALIDE' },
          include: {
            lot: { select: { id: true, reference: true } },
            bien: { select: { id: true, nom: true } },
            entreprise: { select: { id: true, nom: true } },
            contrat: { select: { id: true, reference: true } },
            _count: { select: { documents: true } },
          },
          orderBy: [{ categorie: 'asc' }, { designation: 'asc' }],
        }),
        tx.equipement.findMany({
          where: { operationId, statut: 'PROPOSE' },
          include: { sourceDocument: { select: { id: true, titre: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.contrat.findMany({
          where: { operationId, dateReception: { not: null } },
          select: {
            id: true,
            reference: true,
            dateReception: true,
            finGarantie: true,
            entreprise: { select: { nom: true } },
            cfcNode: { select: { code: true, libelle: true } },
          },
        }),
        tx.document.findMany({
          where: { operationId, isCourant: true, categorie: { in: CATEGORIES_PASSEPORT } },
          select: {
            id: true,
            titre: true,
            categorie: true,
            fileName: true,
            equipementId: true,
            createdAt: true,
          },
          orderBy: [{ categorie: 'asc' }, { titre: 'asc' }],
        }),
      ]);
      return { operation, equipements, propositions, contrats, documents };
    });

    const echeances = calculerEcheances(
      donnees.contrats.map((c) => ({
        id: c.id,
        entreprise: c.entreprise.nom,
        objet: c.cfcNode
          ? `CFC ${c.cfcNode.code} ${c.cfcNode.libelle}`
          : (c.reference ?? `contrat ${c.id}`),
        dateReception: c.dateReception,
        finGarantie: c.finGarantie,
      })),
      donnees.equipements,
    );

    return {
      operation: donnees.operation,
      equipements: donnees.equipements,
      propositions: donnees.propositions,
      echeances,
      completude: PIECES_ATTENDUES.map((p) => ({
        ...p,
        presente: donnees.documents.some((d) => d.categorie === p.categorie),
      })),
      documents: donnees.documents,
      iaDisponible: this.ia.disponible,
    };
  }

  // ===================================================================
  //  Équipements
  // ===================================================================

  async creer(operationId: number, donnees: DonneesEquipement) {
    return this.db.run(async (tx) => {
      const liens = await this.verifierLiens(tx, operationId, donnees);
      const equipement = await tx.equipement.create({
        data: {
          operationId,
          ...donnees,
          ...liens,
          statut: 'VALIDE',
          valideLe: new Date(),
          valideParId: RequestContext.requireWorkspace().membershipId,
        },
      });
      await this.audit.enregistrer(tx, {
        action: 'equipement.cree',
        entite: 'Equipement',
        entiteId: equipement.id,
        donnees: {
          operationId,
          designation: equipement.designation,
          categorie: equipement.categorie,
        },
      });
      return equipement;
    });
  }

  async modifier(operationId: number, id: number, donnees: Partial<DonneesEquipement>) {
    return this.db.run(async (tx) => {
      await this.equipementDeLOperation(tx, operationId, id);
      const liens = await this.verifierLiens(tx, operationId, donnees);
      const equipement = await tx.equipement.update({
        where: { id },
        data: { ...donnees, ...liens },
      });
      await this.audit.enregistrer(tx, {
        action: 'equipement.modifie',
        entite: 'Equipement',
        entiteId: id,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return equipement;
    });
  }

  async supprimer(operationId: number, id: number) {
    return this.db.run(async (tx) => {
      const equipement = await this.equipementDeLOperation(tx, operationId, id);
      await tx.equipement.delete({ where: { id } });
      await this.audit.enregistrer(tx, {
        action: 'equipement.supprime',
        entite: 'Equipement',
        entiteId: id,
        donnees: { operationId, designation: equipement.designation, statut: equipement.statut },
      });
      return { supprime: true };
    });
  }

  /**
   * Une proposition devient un équipement du passeport — avec, le cas
   * échéant, les corrections de celui qui valide. C'est à ce moment, et
   * seulement là, qu'elle existe dans le produit.
   */
  async valider(operationId: number, id: number, corrections: Partial<DonneesEquipement>) {
    return this.db.run(async (tx) => {
      const avant = await this.equipementDeLOperation(tx, operationId, id);
      if (avant.statut !== 'PROPOSE') {
        throw new BadRequestException('Cet équipement est déjà validé.');
      }
      const liens = await this.verifierLiens(tx, operationId, corrections);
      const equipement = await tx.equipement.update({
        where: { id },
        data: {
          ...corrections,
          ...liens,
          statut: 'VALIDE',
          valideLe: new Date(),
          valideParId: RequestContext.requireWorkspace().membershipId,
        },
      });
      await this.audit.enregistrer(tx, {
        action: 'equipement.valide',
        entite: 'Equipement',
        entiteId: id,
        donnees: {
          operationId,
          designation: equipement.designation,
          corrige: Object.keys(corrections),
          source: avant.sourceDocumentId,
        },
      });
      return equipement;
    });
  }

  /** Une proposition écartée disparaît : elle n'a jamais existé dans le passeport. */
  async rejeter(operationId: number, id: number) {
    return this.db.run(async (tx) => {
      const avant = await this.equipementDeLOperation(tx, operationId, id);
      if (avant.statut !== 'PROPOSE') {
        throw new BadRequestException(
          'Seule une proposition se rejette. Un équipement validé se supprime.',
        );
      }
      await tx.equipement.delete({ where: { id } });
      await this.audit.enregistrer(tx, {
        action: 'equipement.proposition_rejetee',
        entite: 'Equipement',
        entiteId: id,
        donnees: { operationId, designation: avant.designation },
      });
      return { rejete: true };
    });
  }

  // ===================================================================
  //  Proposition par l'IA
  // ===================================================================

  /**
   * Lit une notice ou un PV, et **propose** les équipements qu'il décrit.
   *
   * Le texte est masqué (e-mails, téléphones, IBAN) avant de partir chez
   * Infomaniak ; chaque proposition cite son extrait, et une citation
   * introuvable dans le document fait écarter la proposition. Rien n'entre
   * dans le passeport avant la validation d'un humain.
   */
  async proposer(operationId: number, documentId: number) {
    const societeId = RequestContext.requireSocieteId();
    const document = await this.db.run((tx) =>
      tx.document.findFirst({
        where: { id: documentId, operationId },
        select: { id: true, titre: true, mimeType: true, filePath: true },
      }),
    );
    if (!document) throw new NotFoundException(`Document ${documentId} introuvable.`);

    const contenu = await this.stockage.lire(document.filePath);
    let texte: string;
    if (document.mimeType === 'application/pdf') {
      try {
        texte = await this.ocr.extraire(contenu);
      } catch {
        throw new BadRequestException(
          'Le texte de ce PDF ne peut pas être extrait sur ce serveur. Saisissez les équipements à la main.',
        );
      }
    } else if (document.mimeType.startsWith('text/')) {
      texte = contenu.toString('utf8');
    } else {
      throw new BadRequestException(
        'Seuls un PDF ou un fichier texte se lisent pour proposer des équipements.',
      );
    }
    if (texte.trim().length < 20) {
      throw new BadRequestException(
        'Ce document ne contient presque pas de texte lisible — un scan sans reconnaissance de caractères, peut-être.',
      );
    }

    const texteEnvoye = masquer(texte);
    const reponse = await this.ia.completerJson(societeId, 'passeport.equipements', {
      systeme: SYSTEME,
      utilisateur: messageUtilisateur(texteEnvoye),
      schemaJson,
      schema: schemaReponse,
    });
    const { retenues, ecartees } = filtrerParCitation(reponse, texteEnvoye);

    const creees = await this.db.run(async (tx) => {
      const lignes: number[] = [];
      for (const e of retenues) {
        const fin = finGarantie(e.dateMiseEnService, e.garantieMois);
        const cree = await tx.equipement.create({
          data: {
            operationId,
            statut: 'PROPOSE',
            categorie: e.categorie,
            designation: e.designation,
            marque: e.marque,
            modele: e.modele,
            numeroSerie: e.numeroSerie,
            emplacement: e.emplacement,
            dateMiseEnService: e.dateMiseEnService
              ? new Date(`${e.dateMiseEnService}T00:00:00Z`)
              : null,
            garantieFabricantFin: fin,
            entretienPeriodiciteMois: e.entretienPeriodiciteMois,
            // Une durée de garantie sans date de départ ne se calcule pas :
            // on la garde en clair plutôt que de la perdre ou de l'inventer.
            notes:
              e.garantieMois && !fin
                ? `Garantie fabricant : ${e.garantieMois} mois (date de mise en service à compléter).`
                : null,
            sourceDocumentId: document.id,
            sourceExtrait: e.extrait,
          },
          select: { id: true },
        });
        lignes.push(cree.id);
      }
      await this.audit.enregistrer(tx, {
        action: 'passeport.propositions',
        entite: 'Document',
        entiteId: document.id,
        donnees: { operationId, proposees: lignes.length, ecartees },
      });
      return lignes;
    });

    return { proposees: creees.length, ecartees };
  }

  // ===================================================================
  //  Export — le dossier de l'ouvrage, lisible sans Prometis
  // ===================================================================

  /**
   * Une archive ZIP : un index PDF (équipements, échéances, pièces) et les
   * documents du passeport, rangés par catégorie.
   *
   * Journalisée : c'est la remise en un geste de tout le dossier d'un
   * immeuble, le genre d'acte dont on veut savoir qui l'a fait et quand.
   */
  async exporter(operationId: number): Promise<{ nom: string; contenu: Buffer }> {
    const synthese = await this.synthese(operationId);
    const documents = await this.db.run((tx) =>
      tx.document.findMany({
        where: { operationId, isCourant: true, categorie: { in: CATEGORIES_PASSEPORT } },
        select: { id: true, fileName: true, filePath: true, categorie: true },
      }),
    );

    const fichiers: Record<string, Uint8Array> = {
      'index.pdf': await this.indexPdf(synthese),
    };
    for (const d of documents) {
      const nom = `documents/${d.categorie.toLowerCase()}/${d.id}-${assainir(d.fileName)}`;
      fichiers[nom] = new Uint8Array(await this.stockage.lire(d.filePath));
    }

    const contenu = Buffer.from(zipSync(fichiers, { level: 6 }));
    await this.db.run((tx) =>
      this.audit.enregistrer(tx, {
        action: 'passeport.exporte',
        entite: 'Operation',
        entiteId: operationId,
        donnees: { operationId, documents: documents.length, octets: contenu.length },
      }),
    );

    const date = new Date().toISOString().slice(0, 10);
    return { nom: `passeport-${assainir(synthese.operation.nom)}-${date}.zip`, contenu };
  }

  private async indexPdf(
    s: Awaited<ReturnType<PasseportService['synthese']>>,
  ): Promise<Uint8Array> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    const fin = new Promise<void>((ok) => doc.on('end', () => ok()));
    const date = (d: Date | null) => (d ? d.toLocaleDateString('fr-CH') : '—');

    doc.font('Helvetica-Bold').fontSize(18).text(`Passeport de l'ouvrage — ${s.operation.nom}`);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`Établi le ${new Date().toLocaleDateString('fr-CH')} par Prometis.`);
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(13).text('Pièces du dossier');
    doc.font('Helvetica').fontSize(10);
    for (const p of s.completude) doc.text(`${p.presente ? '✓' : '✗'}  ${p.libelle}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(13).text('Échéances');
    doc.font('Helvetica').fontSize(10);
    if (s.echeances.length === 0) doc.text('Aucune garantie ni aucun entretien enregistré.');
    for (const e of s.echeances)
      doc.text(`${date(e.fin)} — ${e.libelle}${e.etat === 'ECHUE' ? ' (échue)' : ''}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(13).text('Équipements');
    doc.font('Helvetica').fontSize(10);
    if (s.equipements.length === 0) doc.text('Aucun équipement enregistré.');
    for (const e of s.equipements) {
      const ou = e.lot ? `lot ${e.lot.reference}` : 'parties communes';
      const qui = e.entreprise ? ` · posé par ${e.entreprise.nom}` : '';
      doc.font('Helvetica-Bold').text(`${e.designation}`, { continued: true });
      doc
        .font('Helvetica')
        .text(`  (${e.categorie.toLowerCase().replace(/_/g, ' ')}, ${ou}${qui})`);
      const details = [
        e.marque && `marque ${e.marque}`,
        e.modele && `modèle ${e.modele}`,
        e.numeroSerie && `n° ${e.numeroSerie}`,
        e.dateMiseEnService && `mis en service le ${date(e.dateMiseEnService)}`,
        e.garantieFabricantFin && `garantie jusqu'au ${date(e.garantieFabricantFin)}`,
        e.entretienPeriodiciteMois && `entretien tous les ${e.entretienPeriodiciteMois} mois`,
      ].filter(Boolean);
      if (details.length) doc.fontSize(9).text(details.join(' · ')).fontSize(10);
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(13).text('Documents joints');
    doc.font('Helvetica').fontSize(10);
    for (const d of s.documents) {
      doc.text(
        `documents/${d.categorie.toLowerCase()}/${d.id}-${assainir(d.fileName)} — ${d.titre}`,
      );
    }

    doc.end();
    await fin;
    return new Uint8Array(Buffer.concat(morceaux));
  }

  // ===================================================================

  private async equipementDeLOperation(tx: TenantDb, operationId: number, id: number) {
    const equipement = await tx.equipement.findFirst({ where: { id, operationId } });
    if (!equipement)
      throw new NotFoundException(`Équipement ${id} introuvable dans cette opération.`);
    return equipement;
  }

  /**
   * Chaque lien désigné appartient à l'opération de la route.
   *
   * La RLS garantit le bon **tenant**, pas la bonne **opération** : sans ce
   * contrôle, un équipement se rattacherait au lot d'une autre promotion de
   * la même société. L'entreprise, elle, vit au niveau de la société.
   *
   * Un contrat désigné sans entreprise apporte la sienne : c'est l'entreprise
   * qui a posé l'équipement, et c'est d'elle que vient la garantie.
   */
  private async verifierLiens(
    tx: TenantDb,
    operationId: number,
    d: Partial<DonneesEquipement>,
  ): Promise<{ entrepriseId?: number }> {
    const refuser = (quoi: string, id: number): never => {
      throw new NotFoundException(`${quoi} ${id} introuvable dans cette opération.`);
    };
    if (d.lotId) {
      const lot = await tx.lot.findFirst({
        where: { id: d.lotId, bien: { operationId } },
        select: { id: true },
      });
      if (!lot) refuser('Lot', d.lotId);
    }
    if (d.bienId) {
      const bien = await tx.bien.findFirst({
        where: { id: d.bienId, operationId },
        select: { id: true },
      });
      if (!bien) refuser('Immeuble', d.bienId);
    }
    if (d.cfcNodeId) {
      const poste = await tx.cfcNode.findFirst({
        where: { id: d.cfcNodeId, operationId },
        select: { id: true },
      });
      if (!poste) refuser('Poste CFC', d.cfcNodeId);
    }
    if (d.entrepriseId) {
      const entreprise = await tx.entreprise.findUnique({
        where: { id: d.entrepriseId },
        select: { id: true },
      });
      if (!entreprise) refuser('Entreprise', d.entrepriseId);
    }
    if (d.contratId) {
      const contrat = await tx.contrat.findFirst({
        where: { id: d.contratId, operationId },
        select: { entrepriseId: true },
      });
      if (!contrat) return refuser('Contrat', d.contratId);
      if (!d.entrepriseId) return { entrepriseId: contrat.entrepriseId };
    }
    return {};
  }
}

/** Un nom de fichier pour une archive : ni chemin, ni caractère exotique. */
function assainir(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document'
  );
}
