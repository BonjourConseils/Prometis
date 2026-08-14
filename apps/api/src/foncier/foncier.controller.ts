import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { montantPositif, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess } from '../auth/decorators';
import { FoncierService } from './foncier.service';

const texteOptionnel = z.string().trim().min(1).max(500).nullish();

const parcelleSchema = z.object({
  numero: z.string().trim().min(1, 'Numéro de parcelle requis.'),
  egrid: texteOptionnel,
  commune: texteOptionnel,
  surfaceM2: nombreDecimal.nullish(),
  affectationZone: texteOptionnel,
  registreFoncier: texteOptionnel,
  note: texteOptionnel,
});

const bienSchema = z.object({
  nature: z.enum(['LOTISSEMENT', 'VILLA', 'IMMEUBLE', 'CHALET']),
  nom: z.string().trim().min(1, 'Nom du bien requis.'),
  nbEtages: z.number().int().min(0).max(100).nullish(),
  description: texteOptionnel,
});

const lotSchema = z.object({
  reference: z.string().trim().min(1, 'Référence de lot requise.'),
  etage: z.number().int().min(-5).max(100).nullish(),
  nombrePieces: nombreDecimal.nullish(),
  surfaceM2: nombreDecimal.nullish(),
  quotePartPPE: nombreDecimal.nullish(),
  prixVente: montantPositif.nullish(),
  statut: z.enum(['DISPONIBLE', 'RESERVE', 'EN_ATTENTE_NOTAIRE', 'VENDU']).optional(),
});

const parkingSchema = z.object({
  reference: texteOptionnel,
  type: z.enum(['EXTERIEURE', 'INTERIEURE', 'COUVERTE', 'BOX', 'AUTRE']),
  prix: montantPositif.nullish(),
  ordre: z.number().int().min(0).optional(),
});

const ppeSchema = z.object({
  bienId: z.number().int().positive().nullish(),
  numero: texteOptionnel,
  dateActeConstitutif: z.coerce.date().nullish(),
  notaireActeurId: z.number().int().positive().nullish(),
  totalMillemes: z.number().int().positive().max(100_000).optional(),
  note: texteOptionnel,
});

/**
 * Foncier et biens d'une opération.
 *
 * Toutes les routes sont imbriquées sous `/operations/:operationId` : c'est ce
 * qui permet au guard de vérifier le droit d'accès sur l'opération ciblée. Une
 * route `/lots/:id` isolée n'aurait rien à quoi rattacher ce contrôle.
 */
@Controller('operations/:operationId')
export class FoncierController {
  constructor(private readonly foncier: FoncierService) {}

  // --- Parcelles ------------------------------------------------------

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FONCIER' })
  @Get('parcelles')
  listerParcelles(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.foncier.listerParcelles(operationId);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FONCIER' })
  @Post('parcelles')
  creerParcelle(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(parcelleSchema)) body: z.infer<typeof parcelleSchema>,
  ) {
    return this.foncier.creerParcelle(operationId, body);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FONCIER' })
  @Patch('parcelles/:parcelleId')
  modifierParcelle(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('parcelleId', ParseIntPipe) parcelleId: number,
    @Body(new ZodBody(parcelleSchema.partial())) body: Partial<z.infer<typeof parcelleSchema>>,
  ) {
    return this.foncier.modifierParcelle(operationId, parcelleId, body);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FONCIER' })
  @Delete('parcelles/:parcelleId')
  supprimerParcelle(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('parcelleId', ParseIntPipe) parcelleId: number,
  ) {
    return this.foncier.supprimerParcelle(operationId, parcelleId);
  }

  // --- Biens ----------------------------------------------------------

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FONCIER' })
  @Get('biens')
  listerBiens(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.foncier.listerBiens(operationId);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FONCIER' })
  @Post('biens')
  creerBien(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(bienSchema)) body: z.infer<typeof bienSchema>,
  ) {
    return this.foncier.creerBien(operationId, body);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FONCIER' })
  @Patch('biens/:bienId')
  modifierBien(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('bienId', ParseIntPipe) bienId: number,
    @Body(new ZodBody(bienSchema.partial())) body: Partial<z.infer<typeof bienSchema>>,
  ) {
    return this.foncier.modifierBien(operationId, bienId, body);
  }

  // --- Lots et places de parc ------------------------------------------

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Post('biens/:bienId/lots')
  creerLot(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('bienId', ParseIntPipe) bienId: number,
    @Body(new ZodBody(lotSchema)) body: z.infer<typeof lotSchema>,
  ) {
    return this.foncier.creerLot(operationId, bienId, body);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Patch('lots/:lotId')
  modifierLot(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('lotId', ParseIntPipe) lotId: number,
    @Body(new ZodBody(lotSchema.partial())) body: Partial<z.infer<typeof lotSchema>>,
  ) {
    return this.foncier.modifierLot(operationId, lotId, body);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Post('lots/:lotId/parkings')
  creerParking(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('lotId', ParseIntPipe) lotId: number,
    @Body(new ZodBody(parkingSchema)) body: z.infer<typeof parkingSchema>,
  ) {
    return this.foncier.creerParking(operationId, lotId, body);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Patch('parkings/:parkingId')
  modifierParking(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('parkingId', ParseIntPipe) parkingId: number,
    @Body(new ZodBody(parkingSchema.partial())) body: Partial<z.infer<typeof parkingSchema>>,
  ) {
    return this.foncier.modifierParking(operationId, parkingId, body);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'VENTES' })
  @Delete('parkings/:parkingId')
  supprimerParking(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('parkingId', ParseIntPipe) parkingId: number,
  ) {
    return this.foncier.supprimerParking(operationId, parkingId);
  }

  // --- PPE -------------------------------------------------------------

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FONCIER' })
  @Get('ppe')
  listerPpe(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.foncier.listerPpe(operationId);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FONCIER' })
  @Post('ppe')
  creerPpe(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(ppeSchema)) body: z.infer<typeof ppeSchema>,
  ) {
    return this.foncier.creerPpe(operationId, body);
  }

  /** Écran « Registre PPE » : quotes-parts, parcelles et contrôle des millièmes. */
  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FONCIER' })
  @Get('registre-ppe')
  registrePpe(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.foncier.registrePpe(operationId);
  }
}
