import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { OrdresPaiementService } from './ordres-paiement.service';

const ibanSchema = z.object({
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), 'IBAN invalide.')
    .nullable(),
  bic: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), 'BIC invalide.')
    .nullish(),
});

const ordreSchema = z.object({
  factureIds: z.array(z.number().int().positive()).min(1).max(200),
  libelle: z.string().trim().min(1).max(200).nullish(),
  dateExecution: z.coerce.date(),
});

/**
 * Les ordres de paiement d'une promotion.
 *
 * La comptabilité compose, le promoteur vise, et le fichier pour la banque
 * ne se télécharge qu'après. Le rôle requis dit qui fait quoi.
 */
@RequireModule('FACTURES')
@Controller('operations/:operationId/ordres-paiement')
export class OrdresPaiementController {
  constructor(private readonly ordres: OrdresPaiementService) {}

  // --- Déclarées avant `:ordreId` : sinon « compte » serait lu comme un numéro.

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get('a-payer')
  aPayer(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.ordres.aPayer(operationId);
  }

  @Roles('OWNER', 'ADMIN')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FACTURES' })
  @Put('compte')
  fixerCompte(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(ibanSchema)) body: z.infer<typeof ibanSchema>,
  ) {
    return this.ordres.fixerCompte(operationId, body);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get()
  lister(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.ordres.lister(operationId);
  }

  @Roles('OWNER', 'ADMIN', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FACTURES' })
  @Post()
  creer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(ordreSchema)) body: z.infer<typeof ordreSchema>,
  ) {
    return this.ordres.creer(operationId, body);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get(':ordreId')
  lire(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ordreId', ParseIntPipe) ordreId: number,
  ) {
    return this.ordres.lire(operationId, ordreId);
  }

  /** Le visa du promoteur : c'est lui qui autorise la sortie d'argent. */
  @Roles('OWNER', 'ADMIN')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FACTURES' })
  @Post(':ordreId/visa')
  @HttpCode(200)
  viser(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ordreId', ParseIntPipe) ordreId: number,
  ) {
    return this.ordres.viser(operationId, ordreId);
  }

  @Roles('OWNER', 'ADMIN', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FACTURES' })
  @Post(':ordreId/annulation')
  @HttpCode(200)
  annuler(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ordreId', ParseIntPipe) ordreId: number,
  ) {
    return this.ordres.annuler(operationId, ordreId);
  }

  /**
   * Le fichier pain.001. Le télécharger vaut transmission : les factures
   * passent à « payée ». Un second téléchargement rend le même fichier.
   */
  @Roles('OWNER', 'ADMIN', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FACTURES' })
  @Get(':ordreId/fichier')
  async fichier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ordreId', ParseIntPipe) ordreId: number,
    @Res() reponse: Response,
  ) {
    const { nom, xml } = await this.ordres.fichier(operationId, ordreId);
    reponse
      .status(200)
      .set({
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nom}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(xml);
  }
}
