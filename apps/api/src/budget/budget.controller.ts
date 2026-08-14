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
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { montant, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess } from '../auth/decorators';
import { CfcService } from './cfc.service';
import { BudgetService } from './budget.service';
import type { CleVentilation } from './cfc-arbre';

const texteOptionnel = z.string().trim().min(1).max(500).nullish();

const noeudSchema = z.object({
  parentId: z.number().int().positive().nullish(),
  code: z
    .string()
    .trim()
    .min(1, 'Code CFC requis.')
    .max(20)
    .regex(/^[0-9]+(\.[0-9]+)*$/, 'Un code CFC est numérique, éventuellement pointé (ex. 232.1).'),
  libelle: z.string().trim().min(1, 'Libellé requis.').max(200),
  ordre: z.number().int().min(0).optional(),
});

const versionSchema = z.object({
  libelle: z.string().trim().min(1, 'Libellé de version requis.').max(120),
  commentaire: texteOptionnel,
  /** Duplique les lignes d'une version existante — le geste normal d'une révision. */
  copierDepuisId: z.number().int().positive().nullish(),
});

const modifierVersionSchema = z
  .object({
    libelle: z.string().trim().min(1).max(120).optional(),
    statut: z.enum(['BROUILLON', 'VALIDE', 'ARCHIVE']).optional(),
    isCourant: z.boolean().optional(),
    commentaire: texteOptionnel,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun changement fourni.' });

const ligneSchema = z.object({
  cfcNodeId: z.number().int().positive(),
  designation: texteOptionnel,
  quantite: nombreDecimal.nullish(),
  prixUnitaire: montant.nullish(),
  // Un montant de ligne peut être négatif : un avoir ou une reprise en moins.
  montant: montant,
  tvaPct: nombreDecimal.nullish(),
  estReserve: z.boolean().optional(),
  note: texteOptionnel,
});

const CLES: CleVentilation[] = ['QUOTE_PART_PPE', 'SURFACE', 'EGALITE'];

/**
 * Budget CFC d'une opération.
 *
 * Comme le foncier, tout est imbriqué sous `/operations/:operationId` : c'est
 * ce qui permet au guard de vérifier le droit sur l'opération ciblée.
 */
@RequireModule('BUDGET_CFC')
@Controller('operations/:operationId')
export class BudgetController {
  constructor(
    private readonly cfc: CfcService,
    private readonly budget: BudgetService,
  ) {}

  // --- Arborescence CFC ------------------------------------------------

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'BUDGET_CFC' })
  @Get('cfc')
  listerCfc(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.cfc.lister(operationId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Post('cfc')
  creerCfc(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(noeudSchema)) body: z.infer<typeof noeudSchema>,
  ) {
    return this.cfc.creer(operationId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Patch('cfc/:cfcNodeId')
  modifierCfc(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('cfcNodeId', ParseIntPipe) cfcNodeId: number,
    @Body(new ZodBody(noeudSchema.partial())) body: Partial<z.infer<typeof noeudSchema>>,
  ) {
    return this.cfc.modifier(operationId, cfcNodeId, body);
  }

  @RequireOperationAccess({ level: 'MANAGE', module: 'BUDGET_CFC' })
  @Delete('cfc/:cfcNodeId')
  supprimerCfc(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('cfcNodeId', ParseIntPipe) cfcNodeId: number,
  ) {
    return this.cfc.supprimer(operationId, cfcNodeId);
  }

  /** Importe la trame CFC de départ dans une opération sans arbre. */
  @RequireOperationAccess({ level: 'MANAGE', module: 'BUDGET_CFC' })
  @Post('cfc/importer-trame')
  @HttpCode(200)
  importerTrame(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.cfc.importerTrame(operationId);
  }

  // --- Versions de budget ----------------------------------------------

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'BUDGET_CFC' })
  @Get('budget/versions')
  listerVersions(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.budget.listerVersions(operationId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Post('budget/versions')
  creerVersion(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(versionSchema)) body: z.infer<typeof versionSchema>,
  ) {
    return this.budget.creerVersion(operationId, body);
  }

  // Adopter un budget engage l'opération : c'est un geste de gestion.
  @RequireOperationAccess({ level: 'MANAGE', module: 'BUDGET_CFC' })
  @Patch('budget/versions/:versionId')
  modifierVersion(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body(new ZodBody(modifierVersionSchema)) body: z.infer<typeof modifierVersionSchema>,
  ) {
    return this.budget.modifierVersion(operationId, versionId, body);
  }

  // --- Lignes ------------------------------------------------------------

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'BUDGET_CFC' })
  @Get('budget/versions/:versionId/lignes')
  listerLignes(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.budget.listerLignes(operationId, versionId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Post('budget/versions/:versionId/lignes')
  creerLigne(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body(new ZodBody(ligneSchema)) body: z.infer<typeof ligneSchema>,
  ) {
    return this.budget.creerLigne(operationId, versionId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Patch('budget/lignes/:ligneId')
  modifierLigne(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ligneId', ParseIntPipe) ligneId: number,
    @Body(new ZodBody(ligneSchema.partial())) body: Partial<z.infer<typeof ligneSchema>>,
  ) {
    return this.budget.modifierLigne(operationId, ligneId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'BUDGET_CFC' })
  @Delete('budget/lignes/:ligneId')
  supprimerLigne(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('ligneId', ParseIntPipe) ligneId: number,
  ) {
    return this.budget.supprimerLigne(operationId, ligneId);
  }

  // --- Vue consolidée ----------------------------------------------------

  /** Écran « Budget CFC » : arbre + initial / révisé / adjugé / facturé / reste à engager. */
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'BUDGET_CFC' })
  @Get('budget')
  vue(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Query('versionId') versionId?: string,
  ) {
    const id = versionId ? Number(versionId) : undefined;
    return this.budget.vueConsolidee(operationId, Number.isInteger(id) ? id : undefined);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'BUDGET_CFC' })
  @Get('budget/ventilation')
  ventilation(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Query('cle') cle?: string,
    @Query('versionId') versionId?: string,
  ) {
    const cleValide = CLES.find((c) => c === cle) ?? 'QUOTE_PART_PPE';
    const id = versionId ? Number(versionId) : undefined;
    return this.budget.ventilation(operationId, cleValide, Number.isInteger(id) ? id : undefined);
  }
}
