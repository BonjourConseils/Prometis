import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { TAILLE_MAX_OCTETS } from '../stockage/chemin';
import { GedService } from './ged.service';

const CATEGORIES = [
  'MANDAT',
  'CONTRAT',
  'DEVIS',
  'SOUMISSION',
  'FACTURE',
  'ACTE_VENTE',
  'RESERVATION',
  'PLAN',
  'PROJET',
  'PERMIS',
  'AUTORISATION',
  'EXTRAIT_RF',
  'PPE_ACTE_CONSTITUTIF',
  'PPE_REGLEMENT',
  'PPE_PLAN',
  'MANDAT_COURTAGE',
  'GARANTIE',
  'PV_RECEPTION',
  'PV_SEANCE',
  'NOTE',
  'PHOTO_CHANTIER',
  'ASSURANCE',
  'AUTRE',
] as const;

const identifiant = z.coerce.number().int().positive().optional();
/** Les champs d'un envoi multipart arrivent en texte : d'où les coercitions. */
const booleen = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true');

const depotSchema = z.object({
  titre: z.string().trim().min(1, 'Titre requis.').max(200),
  description: z.string().trim().max(2000).nullish(),
  categorie: z.enum(CATEGORIES).optional(),
  visibiliteExterne: booleen,
  lotId: identifiant,
  soumissionId: identifiant,
  contratId: identifiant,
  factureId: identifiant,
  reservationId: identifiant,
  acteurId: identifiant,
  seanceId: identifiant,
  parcelleId: identifiant,
  ppeId: identifiant,
  mandatCourtageId: identifiant,
});

const modificationSchema = z.object({
  titre: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  categorie: z.enum(CATEGORIES).optional(),
  visibiliteExterne: z.boolean().optional(),
});

const filtreSchema = z.object({
  categorie: z.enum(CATEGORIES).optional(),
  toutesVersions: booleen,
  lotId: identifiant,
  soumissionId: identifiant,
  contratId: identifiant,
  factureId: identifiant,
  reservationId: identifiant,
  acteurId: identifiant,
  seanceId: identifiant,
  parcelleId: identifiant,
  ppeId: identifiant,
  mandatCourtageId: identifiant,
});

/**
 * GED d'une opération.
 *
 * Tout est sous `/operations/:operationId` : un document appartient au dossier
 * d'une promotion, et c'est ce qui permet au garde de vérifier l'accès à cette
 * promotion. `Document.operationId` est facultatif dans le schéma — aucune
 * route ne crée pour l'instant de document hors opération, faute de contexte
 * où en vérifier l'accès.
 */
@RequireModule('GED')
@Controller('operations/:operationId/documents')
export class DocumentsController {
  constructor(private readonly ged: GedService) {}

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'DOCUMENTS' })
  @Get()
  lister(@Param('operationId', ParseIntPipe) operationId: number, @Query() query: unknown) {
    return this.ged.lister(operationId, filtreSchema.parse(query ?? {}));
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'DOCUMENTS' })
  @Post()
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  deposer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Body(new ZodBody(depotSchema)) body: z.infer<typeof depotSchema>,
  ) {
    return this.ged.deposer(operationId, exigerFichier(fichier), body);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'DOCUMENTS' })
  @Get(':documentId/versions')
  versions(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.ged.versions(operationId, documentId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'DOCUMENTS' })
  @Post(':documentId/versions')
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  deposerVersion(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @UploadedFile() fichier: Express.Multer.File | undefined,
  ) {
    return this.ged.deposerVersion(operationId, documentId, exigerFichier(fichier));
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'DOCUMENTS' })
  @Get(':documentId/contenu')
  async telecharger(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() reponse: Response,
  ): Promise<void> {
    const { document, contenu } = await this.ged.telecharger(operationId, documentId);
    reponse.setHeader('Content-Type', document.mimeType);
    reponse.setHeader('Content-Length', document.fileSize);
    // `attachment` et non `inline` : un fichier déposé par un tiers ne
    // s'affiche pas dans l'origine de l'application — un SVG ou un HTML y
    // exécuterait son propre script.
    reponse.setHeader(
      'Content-Disposition',
      `attachment; filename="${document.fileName.replace(/["\r\n]/g, '')}"`,
    );
    reponse.send(contenu);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'DOCUMENTS' })
  @Patch(':documentId')
  modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body(new ZodBody(modificationSchema)) body: z.infer<typeof modificationSchema>,
  ) {
    return this.ged.modifier(operationId, documentId, body);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @RequireOperationAccess({ level: 'MANAGE', module: 'DOCUMENTS' })
  @Delete(':documentId')
  supprimer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.ged.supprimer(operationId, documentId);
  }
}

function exigerFichier(fichier: Express.Multer.File | undefined) {
  if (!fichier) {
    throw new BadRequestException(
      'Aucun fichier reçu. Envoyer un formulaire multipart avec un champ « fichier ».',
    );
  }
  return {
    nomOriginal: fichier.originalname,
    mimeType: fichier.mimetype || 'application/octet-stream',
    contenu: fichier.buffer,
  };
}
