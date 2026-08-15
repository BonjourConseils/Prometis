import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { montantPositif, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { CourtageService } from './courtage.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';

const mandatSchema = z.object({
  courtierActeurId: z.number().int().positive(),
  commissionType: z.enum(['POURCENTAGE', 'FORFAIT']).optional(),
  commissionPct: nombreDecimal.nullish(),
  commissionForfait: montantPositif.nullish(),
  /** Commission assise sur le prix TTC plutôt que sur le prix hors taxe. */
  assietteTtc: z.boolean().optional(),
  perimetre: z.enum(['TOUTE_OPERATION', 'LOTS_SELECTIONNES']).optional(),
  exclusif: z.boolean().optional(),
  dateSignature: z.coerce.date().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  lotIds: z.array(z.number().int().positive()).max(500).optional(),
});

/** Mandats de courtage et commissions d'une opération. */
@RequireModule('COURTAGE')
@Controller('operations/:operationId/courtage')
export class CourtageController {
  constructor(private readonly courtage: CourtageService) {}

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'VENTES' })
  @Get('mandats')
  listerMandats(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.courtage.listerMandats(operationId);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMMERCIAL')
  @RequireOperationAccess({ level: 'MANAGE', module: 'VENTES' })
  @Post('mandats')
  creerMandat(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(mandatSchema)) body: z.infer<typeof mandatSchema>,
  ) {
    return this.courtage.creerMandat(operationId, body);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @RequireOperationAccess({ level: 'MANAGE', module: 'VENTES' })
  @Patch('mandats/:mandatId/statut')
  changerStatutMandat(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('mandatId', ParseIntPipe) mandatId: number,
    @Body(
      new ZodBody(
        z.object({ statut: z.enum(['BROUILLON', 'SIGNE', 'ACTIF', 'TERMINE', 'RESILIE']) }),
      ),
    )
    body: { statut: 'BROUILLON' | 'SIGNE' | 'ACTIF' | 'TERMINE' | 'RESILIE' },
  ) {
    return this.courtage.changerStatutMandat(operationId, mandatId, body.statut);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'VENTES' })
  @Get('commissions')
  listerCommissions(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.courtage.listerCommissions(operationId);
  }

  /**
   * Constate les commissions dues sur une vente.
   *
   * Idempotent : une commission déjà constatée pour ce couple (mandat,
   * réservation) n'est pas recréée — elle est signalée comme ignorée.
   */
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMMERCIAL')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Post('reservations/:reservationId/commissions')
  @HttpCode(200)
  constater(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('reservationId', ParseIntPipe) reservationId: number,
  ) {
    return this.courtage.constaterCommissions(operationId, reservationId);
  }

  @Roles('OWNER', 'ADMIN', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Patch('commissions/:commissionId')
  changerStatutCommission(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('commissionId', ParseIntPipe) commissionId: number,
    @Body(
      new ZodBody(
        z.object({
          statut: z.enum(['DUE', 'FACTUREE', 'PAYEE', 'ANNULEE']),
          dateDue: z.coerce.date().nullish(),
        }),
      ),
    )
    body: { statut: 'DUE' | 'FACTUREE' | 'PAYEE' | 'ANNULEE'; dateDue?: Date | null },
  ) {
    return this.courtage.changerStatutCommission(operationId, commissionId, body);
  }
}

/** Trésorerie consolidée d'une opération. */
@RequireModule('TRESORERIE')
@Controller('operations/:operationId/tresorerie')
export class TresorerieController {
  constructor(private readonly tresorerie: TresorerieService) {}

  // Pas de module d'accès « trésorerie » dans le schéma : la vue agrège des
  // appels de fonds, c'est ce droit-là qui la borne.
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'APPELS_FONDS' })
  @Get()
  situation(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.tresorerie.situation(operationId);
  }
}
