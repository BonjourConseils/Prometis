import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentCategorie } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { StockageService } from '../stockage/stockage.service';

/** Les onze rattachements possibles d'un document (cf. `schema.prisma`). */
export interface Rattachements {
  lotId?: number | null;
  soumissionId?: number | null;
  contratId?: number | null;
  factureId?: number | null;
  reservationId?: number | null;
  acteurId?: number | null;
  seanceId?: number | null;
  parcelleId?: number | null;
  ppeId?: number | null;
  mandatCourtageId?: number | null;
}

export interface Fichier {
  nomOriginal: string;
  mimeType: string;
  contenu: Buffer;
}

@Injectable()
export class GedService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly stockage: StockageService,
  ) {}

  // ===================================================================
  //  Dépôt
  // ===================================================================

  /**
   * Dépose un document dans l'opération.
   *
   * L'ordre compte : on **valide d'abord**, on écrit le fichier ensuite, on
   * enregistre la fiche en dernier. Écrire avant de valider laisserait des
   * octets orphelins sur le support à chaque refus.
   */
  async deposer(
    operationId: number,
    fichier: Fichier,
    donnees: {
      titre: string;
      description?: string | null;
      categorie?: DocumentCategorie;
      visibiliteExterne?: boolean;
    } & Rattachements,
  ) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;

    await this.db.run((tx) => this.verifierRattachements(tx, operationId, donnees));

    const objet = await this.stockage.deposer({
      societeId,
      operationId,
      nomFichier: fichier.nomOriginal,
      contenu: fichier.contenu,
    });

    return this.db.run(async (tx) => {
      const document = await tx.document.create({
        data: {
          societeId,
          operationId,
          titre: donnees.titre,
          description: donnees.description ?? null,
          categorie: donnees.categorie ?? 'AUTRE',
          visibiliteExterne: donnees.visibiliteExterne ?? false,
          fileName: fichier.nomOriginal,
          filePath: objet.cle,
          mimeType: fichier.mimeType,
          fileSize: objet.taille,
          version: 1,
          isCourant: true,
          uploadedById: membershipId,
          ...extraireRattachements(donnees),
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'document.depose',
        entite: 'Document',
        entiteId: document.id,
        donnees: {
          operationId,
          titre: document.titre,
          categorie: document.categorie,
          taille: objet.taille,
          visibiliteExterne: document.visibiliteExterne,
        },
      });

      return document;
    });
  }

  /**
   * Dépose une nouvelle version d'un document existant.
   *
   * L'ancienne version n'est **pas** écrasée : elle perd son drapeau
   * « courant » et reste consultable. Un plan remplacé reste la pièce sur
   * laquelle une entreprise a peut-être chiffré son offre — l'effacer
   * effacerait la preuve.
   */
  async deposerVersion(operationId: number, documentId: number, fichier: Fichier) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;

    const courant = await this.db.run((tx) =>
      tx.document.findFirst({
        where: { id: documentId, operationId },
        select: {
          id: true,
          titre: true,
          description: true,
          categorie: true,
          visibiliteExterne: true,
          version: true,
          parentDocumentId: true,
          lotId: true,
          soumissionId: true,
          contratId: true,
          factureId: true,
          reservationId: true,
          acteurId: true,
          seanceId: true,
          parcelleId: true,
          ppeId: true,
          mandatCourtageId: true,
        },
      }),
    );
    if (!courant) throw new NotFoundException(`Document ${documentId} introuvable.`);

    // La racine de la chaîne, jamais un maillon : sinon les versions
    // formeraient un arbre au lieu d'une suite, et « dernière version » n'aurait
    // plus de sens unique.
    const racineId = courant.parentDocumentId ?? courant.id;

    const objet = await this.stockage.deposer({
      societeId,
      operationId,
      nomFichier: fichier.nomOriginal,
      contenu: fichier.contenu,
    });

    return this.db.run(async (tx) => {
      const derniere = await tx.document.aggregate({
        where: { OR: [{ id: racineId }, { parentDocumentId: racineId }] },
        _max: { version: true },
      });

      await tx.document.updateMany({
        where: { OR: [{ id: racineId }, { parentDocumentId: racineId }] },
        data: { isCourant: false },
      });

      const version = await tx.document.create({
        data: {
          societeId,
          operationId,
          parentDocumentId: racineId,
          version: (derniere._max.version ?? courant.version) + 1,
          isCourant: true,
          titre: courant.titre,
          description: courant.description,
          categorie: courant.categorie,
          visibiliteExterne: courant.visibiliteExterne,
          fileName: fichier.nomOriginal,
          filePath: objet.cle,
          mimeType: fichier.mimeType,
          fileSize: objet.taille,
          uploadedById: membershipId,
          lotId: courant.lotId,
          soumissionId: courant.soumissionId,
          contratId: courant.contratId,
          factureId: courant.factureId,
          reservationId: courant.reservationId,
          acteurId: courant.acteurId,
          seanceId: courant.seanceId,
          parcelleId: courant.parcelleId,
          ppeId: courant.ppeId,
          mandatCourtageId: courant.mandatCourtageId,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'document.nouvelle_version',
        entite: 'Document',
        entiteId: version.id,
        donnees: { operationId, racineId, version: version.version, titre: version.titre },
      });

      return version;
    });
  }

  // ===================================================================
  //  Consultation
  // ===================================================================

  /**
   * Liste les documents de l'opération.
   *
   * Par défaut, **les versions courantes seulement** : une GED qui affiche
   * toutes les versions à plat ne se lit plus dès la deuxième révision d'un
   * plan.
   */
  async lister(
    operationId: number,
    filtres: {
      categorie?: DocumentCategorie;
      toutesVersions?: boolean;
      visibiliteExterne?: boolean;
    } & Rattachements = {},
  ) {
    const rattachements = extraireRattachements(filtres);
    return this.db.run((tx) =>
      tx.document.findMany({
        where: {
          operationId,
          ...(filtres.categorie ? { categorie: filtres.categorie } : {}),
          ...(filtres.toutesVersions ? {} : { isCourant: true }),
          ...(filtres.visibiliteExterne === undefined
            ? {}
            : { visibiliteExterne: filtres.visibiliteExterne }),
          ...rattachements,
        },
        include: {
          _count: { select: { versions: true } },
          lot: { select: { reference: true } },
          seance: { select: { titre: true } },
        },
        orderBy: [{ categorie: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  }

  /** Toutes les versions d'un document, de la plus récente à la plus ancienne. */
  async versions(operationId: number, documentId: number) {
    const document = await this.db.run((tx) =>
      tx.document.findFirst({
        where: { id: documentId, operationId },
        select: { id: true, parentDocumentId: true },
      }),
    );
    if (!document) throw new NotFoundException(`Document ${documentId} introuvable.`);
    const racineId = document.parentDocumentId ?? document.id;

    return this.db.run((tx) =>
      tx.document.findMany({
        where: { OR: [{ id: racineId }, { parentDocumentId: racineId }] },
        orderBy: { version: 'desc' },
      }),
    );
  }

  /** Renvoie la fiche et le contenu, pour le téléchargement. */
  async telecharger(operationId: number, documentId: number) {
    const document = await this.db.run((tx) =>
      tx.document.findFirst({
        where: { id: documentId, operationId },
        select: { id: true, fileName: true, filePath: true, mimeType: true, fileSize: true },
      }),
    );
    if (!document) throw new NotFoundException(`Document ${documentId} introuvable.`);

    const contenu = await this.stockage.lire(document.filePath);
    return { document, contenu };
  }

  // ===================================================================
  //  Modification et suppression
  // ===================================================================

  async modifier(
    operationId: number,
    documentId: number,
    donnees: {
      titre?: string;
      description?: string | null;
      categorie?: DocumentCategorie;
      visibiliteExterne?: boolean;
    },
  ) {
    return this.db.run(async (tx) => {
      const existant = await tx.document.findFirst({
        where: { id: documentId, operationId },
        select: { id: true, visibiliteExterne: true, titre: true },
      });
      if (!existant) throw new NotFoundException(`Document ${documentId} introuvable.`);

      const document = await tx.document.update({ where: { id: documentId }, data: donnees });

      // Ouvrir une pièce à l'extérieur est une décision, pas un détail
      // d'édition : elle est tracée séparément du reste.
      if (
        donnees.visibiliteExterne !== undefined &&
        donnees.visibiliteExterne !== existant.visibiliteExterne
      ) {
        await this.audit.enregistrer(tx, {
          action: donnees.visibiliteExterne ? 'document.partage_externe' : 'document.repli_interne',
          entite: 'Document',
          entiteId: documentId,
          donnees: { operationId, titre: document.titre },
        });
      }

      return document;
    });
  }

  /**
   * Supprime un document.
   *
   * Une version intermédiaire ne se supprime pas seule : elle appartient à une
   * chaîne, et la retirer laisserait un trou dans un historique dont on se sert
   * précisément pour prouver ce qui a été transmis, et quand.
   */
  async supprimer(operationId: number, documentId: number) {
    const cible = await this.db.run(async (tx) => {
      const document = await tx.document.findFirst({
        where: { id: documentId, operationId },
        select: {
          id: true,
          titre: true,
          filePath: true,
          parentDocumentId: true,
          _count: { select: { versions: true } },
        },
      });
      if (!document) throw new NotFoundException(`Document ${documentId} introuvable.`);
      if (document.parentDocumentId !== null) {
        throw new BadRequestException(
          "Cette pièce est une version d'un document : supprimer le document entier, ou " +
            'déposer une nouvelle version. Retirer un maillon romprait l’historique.',
        );
      }
      if (document._count.versions > 0) {
        throw new BadRequestException(
          `Ce document porte ${document._count.versions} version(s) ultérieure(s). ` +
            'Les supprimer d’abord, ou conserver le document.',
        );
      }

      await tx.document.delete({ where: { id: documentId } });
      await this.audit.enregistrer(tx, {
        action: 'document.supprime',
        entite: 'Document',
        entiteId: documentId,
        donnees: { operationId, titre: document.titre },
      });
      return document;
    });

    // Le fichier part APRÈS le commit : supprimé avant, un échec de
    // transaction laisserait une fiche pointant sur du vide.
    await this.stockage.supprimer(cible.filePath);
    return { supprime: true, titre: cible.titre };
  }

  // ===================================================================
  //  Cohérence des rattachements
  // ===================================================================

  /**
   * Vérifie que chaque parent désigné appartient bien à l'opération de la route.
   *
   * La RLS garantit le bon **tenant**, pas la bonne **opération** : sans ce
   * contrôle, on rattacherait un document à un lot d'une autre promotion de la
   * même société, et il apparaîtrait dans le dossier de quelqu'un d'autre.
   */
  private async verifierRattachements(
    tx: TenantDb,
    operationId: number,
    rattachements: Rattachements,
  ): Promise<void> {
    const controles: [number | null | undefined, string, () => Promise<unknown>][] = [
      [
        rattachements.lotId,
        'lot',
        () =>
          tx.lot.findFirst({
            where: { id: rattachements.lotId!, bien: { operationId } },
            select: { id: true },
          }),
      ],
      [
        rattachements.soumissionId,
        'soumission',
        () =>
          tx.soumission.findFirst({
            where: { id: rattachements.soumissionId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.contratId,
        'contrat',
        () =>
          tx.contrat.findFirst({
            where: { id: rattachements.contratId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.factureId,
        'facture',
        () =>
          tx.facture.findFirst({
            where: { id: rattachements.factureId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.reservationId,
        'réservation',
        () =>
          tx.reservation.findFirst({
            where: { id: rattachements.reservationId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.seanceId,
        'séance',
        () =>
          tx.seance.findFirst({
            where: { id: rattachements.seanceId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.parcelleId,
        'parcelle',
        () =>
          tx.parcelle.findFirst({
            where: { id: rattachements.parcelleId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.ppeId,
        'PPE',
        () =>
          tx.ppe.findFirst({
            where: { id: rattachements.ppeId!, operationId },
            select: { id: true },
          }),
      ],
      [
        rattachements.mandatCourtageId,
        'mandat de courtage',
        () =>
          tx.mandatCourtage.findFirst({
            where: { id: rattachements.mandatCourtageId!, operationId },
            select: { id: true },
          }),
      ],
      // L'acteur est au niveau de la société, pas de l'opération : la RLS
      // suffit à le borner, et un même notaire sert plusieurs promotions.
      [
        rattachements.acteurId,
        'acteur',
        () => tx.acteur.findFirst({ where: { id: rattachements.acteurId! }, select: { id: true } }),
      ],
    ];

    for (const [valeur, libelle, verifier] of controles) {
      if (!valeur) continue;
      if (!(await verifier())) {
        throw new NotFoundException(`Aucun ${libelle} ${valeur} dans cette opération.`);
      }
    }
  }
}

/** Ne garde que les clés de rattachement effectivement fournies. */
function extraireRattachements(source: Rattachements): Rattachements {
  const cles: (keyof Rattachements)[] = [
    'lotId',
    'soumissionId',
    'contratId',
    'factureId',
    'reservationId',
    'acteurId',
    'seanceId',
    'parcelleId',
    'ppeId',
    'mandatCourtageId',
  ];
  const retenu: Rattachements = {};
  for (const cle of cles) {
    if (source[cle] !== undefined && source[cle] !== null) retenu[cle] = source[cle];
  }
  return retenu;
}
