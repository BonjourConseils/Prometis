import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequireOperationAccess, Roles } from '../auth/decorators';
import { AccesService } from './acces.service';

const ROLES = [
  'OWNER',
  'ADMIN',
  'CHEF_PROJET',
  'ECONOMISTE',
  'COMPTABILITE',
  'COMMERCIAL',
  'LECTURE_SEULE',
  'EXTERNE',
] as const;

const ACCESS_MODULES = [
  'FONCIER',
  'BUDGET_CFC',
  'SOUMISSIONS',
  'CONTRATS',
  'FACTURES',
  'VENTES',
  'APPELS_FONDS',
  'DOCUMENTS',
  'SEANCES',
  'ACTEURS',
] as const;

const modifierMembreSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: 'Fournir au moins `role` ou `isActive`.',
  });

const accorderAccesSchema = z.object({
  accessLevel: z.enum(['READ_ONLY', 'OPERATE', 'MANAGE']),
  // Vide = tout ce que le niveau permet. Non vide = restriction fine,
  // typiquement pour un intervenant externe.
  modules: z.array(z.enum(ACCESS_MODULES)).default([]),
});

/** Écran « Droits d'accès » : membres du tenant et droits par opération. */
@Controller('acces')
export class AccesController {
  constructor(private readonly acces: AccesService) {}

  /** Droits effectifs de l'utilisateur courant — tout rôle, y compris EXTERNE. */
  @Get('mes-droits')
  async mesDroits() {
    return this.acces.mesDroits();
  }

  @Roles('OWNER', 'ADMIN')
  @Get('membres')
  async listerMembres() {
    return this.acces.listerMembres();
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('membres/:membershipId')
  async modifierMembre(
    @Param('membershipId', ParseIntPipe) membershipId: number,
    @Body(new ZodBody(modifierMembreSchema)) body: z.infer<typeof modifierMembreSchema>,
  ) {
    return this.acces.modifierMembre(membershipId, body);
  }

  // Gérer les droits sur une opération suppose de gérer l'opération elle-même.
  @RequireOperationAccess({ level: 'MANAGE' })
  @Get('operations/:operationId')
  async listerAccesOperation(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.acces.listerAccesOperation(operationId);
  }

  @RequireOperationAccess({ level: 'MANAGE' })
  @Put('operations/:operationId/membres/:membershipId')
  async accorderAcces(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('membershipId', ParseIntPipe) membershipId: number,
    @Body(new ZodBody(accorderAccesSchema)) body: z.infer<typeof accorderAccesSchema>,
  ) {
    return this.acces.accorderAcces(operationId, membershipId, body.accessLevel, body.modules);
  }

  @RequireOperationAccess({ level: 'MANAGE' })
  @Delete('operations/:operationId/membres/:membershipId')
  async revoquerAcces(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('membershipId', ParseIntPipe) membershipId: number,
  ) {
    return this.acces.revoquerAcces(operationId, membershipId);
  }
}
