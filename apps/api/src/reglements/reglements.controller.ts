import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { ReglementsService } from './reglements.service';

const communeSchema = z.object({
  nom: z.string().trim().min(2).max(120),
  canton: z.string().trim().length(2),
});

const validationSchema = z.object({ valide: z.boolean() });

const reglementSchema = z.object({
  titre: z.string().trim().min(3).max(200),
  version: z.string().trim().min(1).max(60).nullish(),
  url: z.string().trim().min(5).max(500).nullish(),
});

/**
 * Les règlements communaux — **référence partagée**, pas une ressource de
 * promotion.
 *
 * D'où l'absence de `operations/:operationId` dans les chemins, et
 * l'absence de `RequireOperationAccess` : ces données n'appartiennent à
 * aucune promotion ni à aucune société. Toute personne connectée les lit ;
 * l'écriture reste bornée par les droits de la base, qui refuse la
 * suppression d'une commune ou d'un règlement.
 */
@Controller('communes')
export class ReglementsController {
  constructor(private readonly reglements: ReglementsService) {}

  @Get()
  lister() {
    return this.reglements.listerCommunes();
  }

  @Post()
  creer(@Body(new ZodBody(communeSchema)) body: z.infer<typeof communeSchema>) {
    return this.reglements.trouverOuCreerCommune(body.nom, body.canton);
  }

  @Post(':communeId/reglements')
  enregistrer(
    @Param('communeId', ParseIntPipe) communeId: number,
    @Body(new ZodBody(reglementSchema)) body: z.infer<typeof reglementSchema>,
  ) {
    return this.reglements.enregistrer(communeId, body);
  }

  /**
   * Ce que le règlement dit d'une affectation donnée.
   *
   * Appelé par l'écran Foncier avec la commune et la zone écrites sur la
   * parcelle — « Martigny », « Zone d'habitat collectif B (3) ».
   */
  @Get('zone')
  zonePour(@Query('commune') commune: string, @Query('affectation') affectation?: string) {
    if (!commune?.trim()) return null;
    return this.reglements.zoneProposee(commune, affectation ?? null);
  }

  @Get('reglements/:reglementId')
  lireFiche(@Param('reglementId', ParseIntPipe) reglementId: number) {
    return this.reglements.lireReglement(reglementId);
  }

  /** Déposer le PDF — quand la commune ne le publie pas en ligne. */
  @Post('reglements/:reglementId/fichier')
  @UseInterceptors(FileInterceptor('fichier'))
  deposer(
    @Param('reglementId', ParseIntPipe) reglementId: number,
    @UploadedFile() fichier: { originalname: string; buffer: Buffer } | undefined,
  ) {
    if (!fichier) {
      return this.reglements.lireReglement(reglementId);
    }
    return this.reglements.deposerFichier(reglementId, {
      nom: fichier.originalname,
      contenu: fichier.buffer,
    });
  }

  /**
   * Tirer les zones du texte lu — l'IA propose, personne n'est engagé.
   *
   * Chaque valeur arrive avec son extrait et un ancrage calculé ; aucune ne
   * remonte sur une parcelle avant d'avoir été validée.
   */
  @Post('reglements/:reglementId/zones')
  @HttpCode(200)
  extraireZones(@Param('reglementId', ParseIntPipe) reglementId: number) {
    return this.reglements.extraireZones(reglementId);
  }

  /** Valider une zone : le geste qui la rend utilisable sur une parcelle. */
  @Post('zones/:zoneId/valider')
  @HttpCode(200)
  validerZone(
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body(new ZodBody(validationSchema)) body: z.infer<typeof validationSchema>,
  ) {
    return this.reglements.validerZone(zoneId, body.valide);
  }

  /** Lire le règlement : en extraire le texte, par sa couche ou par OCR. */
  @Post('reglements/:reglementId/lire')
  @HttpCode(200)
  lire(@Param('reglementId', ParseIntPipe) reglementId: number) {
    return this.reglements.lire(reglementId);
  }
}
