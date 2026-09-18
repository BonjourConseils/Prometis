import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequireModule, RequireOperationAccess } from '../auth/decorators';
import { ZodBody } from '../common/zod-body.pipe';
import { PasseportService } from './passeport.service';
import { CATEGORIES } from './extraction';

const texte = (max: number) => z.string().trim().max(max).nullish();
const identifiant = z.number().int().positive().nullish();
const date = z.coerce.date().nullish();

const equipementSchema = z.object({
  categorie: z.enum(CATEGORIES as [(typeof CATEGORIES)[number], ...(typeof CATEGORIES)[number][]]),
  designation: z.string().trim().min(2).max(200),
  marque: texte(120),
  modele: texte(120),
  numeroSerie: texte(120),
  emplacement: texte(200),
  bienId: identifiant,
  lotId: identifiant,
  entrepriseId: identifiant,
  contratId: identifiant,
  cfcNodeId: identifiant,
  dateMiseEnService: date,
  garantieFabricantFin: date,
  entretienPeriodiciteMois: z.number().int().min(1).max(120).nullish(),
  dernierEntretien: date,
  notes: texte(2000),
});

type Equipement = z.infer<typeof equipementSchema>;

/**
 * Le passeport numérique d'une opération.
 *
 * Les lectures — synthèse et **export** — passent aussi quand le module est
 * résilié : c'est le document qu'on cherche dix ans après la livraison, pas
 * pendant l'abonnement. Les écritures, elles, exigent le module ouvert.
 */
@RequireModule('PASSEPORT')
@Controller('operations/:operationId/passeport')
export class PasseportController {
  constructor(private readonly passeport: PasseportService) {}

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'PASSEPORT' })
  @Get()
  synthese(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.passeport.synthese(operationId);
  }

  /** Le dossier de l'ouvrage, en une archive lisible sans Prometis. */
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'PASSEPORT' })
  @Get('export')
  async exporter(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Res() reponse: Response,
  ): Promise<void> {
    const { nom, contenu } = await this.passeport.exporter(operationId);
    reponse.setHeader('Content-Type', 'application/zip');
    reponse.setHeader('Content-Length', contenu.length);
    reponse.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    reponse.setHeader('Cache-Control', 'private, no-store');
    reponse.send(contenu);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'PASSEPORT' })
  @Post('equipements')
  creer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(equipementSchema)) body: Equipement,
  ) {
    return this.passeport.creer(operationId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'PASSEPORT' })
  @Patch('equipements/:equipementId')
  modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('equipementId', ParseIntPipe) equipementId: number,
    @Body(new ZodBody(equipementSchema.partial())) body: Partial<Equipement>,
  ) {
    return this.passeport.modifier(operationId, equipementId, body);
  }

  @RequireOperationAccess({ level: 'MANAGE', module: 'PASSEPORT' })
  @Delete('equipements/:equipementId')
  @HttpCode(200)
  supprimer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('equipementId', ParseIntPipe) equipementId: number,
  ) {
    return this.passeport.supprimer(operationId, equipementId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'PASSEPORT' })
  @Post('equipements/:equipementId/valider')
  @HttpCode(200)
  valider(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('equipementId', ParseIntPipe) equipementId: number,
    @Body(new ZodBody(equipementSchema.partial())) body: Partial<Equipement>,
  ) {
    return this.passeport.valider(operationId, equipementId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'PASSEPORT' })
  @Post('equipements/:equipementId/rejeter')
  @HttpCode(200)
  rejeter(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('equipementId', ParseIntPipe) equipementId: number,
  ) {
    return this.passeport.rejeter(operationId, equipementId);
  }

  /** Proposer les équipements d'une notice — l'IA propose, un humain valide. */
  @RequireOperationAccess({ level: 'OPERATE', module: 'PASSEPORT' })
  @Post('propositions')
  @HttpCode(200)
  proposer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(z.object({ documentId: z.number().int().positive() })))
    body: { documentId: number },
  ) {
    return this.passeport.proposer(operationId, body.documentId);
  }
}
