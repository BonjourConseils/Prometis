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
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequireOperationAccess, Roles } from '../auth/decorators';
import { AccesService } from './acces.service';
import { InvitationsService } from './invitations.service';
import { Public } from '../auth/decorators';

const acceptationSchema = z.object({
  motDePasse: z.string().min(1).max(200),
  prenom: z.string().trim().max(100).nullish(),
  nom: z.string().trim().max(100).nullish(),
  prisConnaissance: z.boolean(),
});

/**
 * Accepter une invitation : la personne n'a pas encore de place dans la
 * société, donc pas de session. `@Public` ; la barrière est le lien (usage
 * unique, quatorze jours) et, pour un compte existant, son mot de passe.
 */
@Controller('invitations')
export class InvitationsPubliquesController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Get(':jeton')
  lire(@Param('jeton') jeton: string) {
    return this.invitations.lire(jeton);
  }

  @Public()
  @Post(':jeton/accepter')
  @HttpCode(200)
  accepter(
    @Param('jeton') jeton: string,
    @Body(new ZodBody(acceptationSchema)) body: z.infer<typeof acceptationSchema>,
  ) {
    return this.invitations.accepter(jeton, body);
  }
}

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
  'PASSEPORT',
] as const;

const ACTEURS_EXTERNES = [
  'ARCHITECTE',
  'DIRECTION_TRAVAUX',
  'INGENIEUR',
  'BUREAU_TECHNIQUE',
  'ENTREPRISE_GENERALE',
  'PILOTE',
  'AUTRE',
] as const;

const invitationSchema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide.').max(200),
  prenom: z.string().trim().max(100).nullish(),
  nom: z.string().trim().max(100).nullish(),
  externe: z.boolean(),
  role: z.enum(ROLES).optional(),
  fonction: z.string().trim().max(120).nullish(),
  acteurType: z.enum(ACTEURS_EXTERNES).nullish(),
  societeNom: z.string().trim().max(200).nullish(),
  acces: z
    .array(
      z.object({
        operationId: z.number().int().positive(),
        accessLevel: z.enum(['READ_ONLY', 'OPERATE', 'MANAGE']),
        modules: z.array(z.enum(ACCESS_MODULES)).default([]),
      }),
    )
    .max(100)
    .default([]),
  directionTravauxDe: z.array(z.number().int().positive()).max(100).default([]),
});

const directionTravauxSchema = z.object({ membershipId: z.number().int().positive().nullable() });

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
  constructor(
    private readonly acces: AccesService,
    private readonly invitations: InvitationsService,
  ) {}

  // --- Invitations ----------------------------------------------------

  @Roles('OWNER', 'ADMIN')
  @Get('invitations')
  listerInvitations() {
    return this.invitations.lister();
  }

  @Roles('OWNER', 'ADMIN')
  @Post('invitations')
  inviter(@Body(new ZodBody(invitationSchema)) body: z.infer<typeof invitationSchema>) {
    return this.invitations.inviter(body);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('invitations/:invitationId/renvoyer')
  @HttpCode(200)
  renvoyer(@Param('invitationId', ParseIntPipe) invitationId: number) {
    return this.invitations.renvoyer(invitationId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('invitations/:invitationId/revoquer')
  @HttpCode(200)
  revoquerInvitation(@Param('invitationId', ParseIntPipe) invitationId: number) {
    return this.invitations.revoquer(invitationId);
  }

  // Nommer la DT d'une opération suppose de la gérer.
  @RequireOperationAccess({ level: 'MANAGE' })
  @Put('operations/:operationId/direction-travaux')
  nommerDirectionTravaux(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(directionTravauxSchema)) body: z.infer<typeof directionTravauxSchema>,
  ) {
    return this.invitations.nommerDirectionTravaux(operationId, body.membershipId);
  }

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
