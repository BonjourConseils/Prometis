import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { montantPositif } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { OperationsService, type OperationListItem } from './operations.service';
import { BilanService } from './bilan.service';

const texteOptionnel = z.string().trim().min(1).max(500).nullish();

const operationSchema = z.object({
  nom: z.string().trim().min(1, "Nom de l'opération requis."),
  description: texteOptionnel,
  commune: texteOptionnel,
  canton: texteOptionnel,
  parcelle: texteOptionnel,
  statut: z
    .enum([
      'MONTAGE',
      'EN_PREPARATION',
      'EN_CHANTIER',
      'EN_COMMERCIALISATION',
      'LIVRAISON',
      'CLOTUREE',
    ])
    .optional(),
  dateDebut: z.coerce.date().nullish(),
  dateLivraisonPrevue: z.coerce.date().nullish(),
  prixTerrain: montantPositif.nullish(),
  fraisNotaireTerrain: montantPositif.nullish(),
  droitsMutation: montantPositif.nullish(),
  terrainAvecBatiment: z.boolean().optional(),
  modeRealisation: z
    .enum(['ENTREPRISE_GENERALE', 'MANDAT_ARCHITECTE', 'CORPS_DETAT_SEPARES'])
    .nullish(),
  notaireActeurId: z.number().int().positive().nullish(),
  maitreOuvrageActeurId: z.number().int().positive().nullish(),
  commercialisationActive: z.boolean().optional(),
});

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly bilanService: BilanService,
  ) {}

  @Get()
  async findAll(): Promise<OperationListItem[]> {
    return this.operations.findAll();
  }

  @RequireModule('FONCIER')
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Post()
  async creer(@Body(new ZodBody(operationSchema)) body: z.infer<typeof operationSchema>) {
    return this.operations.creer(body);
  }

  @RequireModule('FONCIER')
  @RequireOperationAccess({ level: 'MANAGE', module: 'FONCIER' })
  @Patch(':operationId')
  async modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(operationSchema.partial())) body: Partial<z.infer<typeof operationSchema>>,
  ) {
    return this.operations.modifier(operationId, body);
  }

  @RequireOperationAccess({ level: 'READ_ONLY' })
  @Get(':operationId')
  async findOne(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.operations.findOne(operationId);
  }

  /** Bilan promoteur : coûts CFC contre recettes lots + parkings. */
  @RequireModule('BILAN_PROMOTEUR')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'VENTES' })
  @Get(':operationId/bilan')
  async bilan(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.bilanService.pourOperation(operationId);
  }
}
