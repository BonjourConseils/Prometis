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
import { RequireModule, RequireOperationAccess } from '../auth/decorators';
import { SeancesService } from './seances.service';

const TYPES = [
  'CHANTIER',
  'ADJUDICATION',
  'COPIL',
  'PROMOTEUR',
  'TECHNIQUE',
  'CLIENT_ACQUEREUR',
  'NOTAIRE',
  'AUTRE',
] as const;

const texte = z.string().trim().min(1).max(2000).nullish();

const seanceSchema = z.object({
  titre: z.string().trim().min(1, 'Titre requis.').max(200),
  type: z.enum(TYPES).optional(),
  date: z.coerce.date().nullish(),
  lieu: z.string().trim().max(200).nullish(),
  ordreDuJour: z.string().trim().max(5000).nullish(),
  numero: z.string().trim().max(50).nullish(),
});

const modificationSchema = seanceSchema.partial().extend({
  statut: z.enum(['PLANIFIEE', 'TENUE', 'ANNULEE']).optional(),
  notes: z.string().trim().max(20_000).nullish(),
});

const participantSchema = z.object({
  membershipId: z.number().int().positive().nullish(),
  acteurId: z.number().int().positive().nullish(),
  nom: z.string().trim().min(1).max(200).nullish(),
  organisation: z.string().trim().max(200).nullish(),
  email: z.string().trim().email('Adresse e-mail invalide.').nullish(),
  present: z.boolean().optional(),
});

const pointSchema = z.object({
  titre: z.string().trim().min(1, 'Titre requis.').max(300),
  ordre: z.number().int().min(1).max(500).optional(),
  contenu: texte,
  responsable: z.string().trim().max(200).nullish(),
  echeance: z.coerce.date().nullish(),
  cfcNodeId: z.number().int().positive().nullish(),
});

const modificationPointSchema = pointSchema
  .omit({ cfcNodeId: true })
  .partial()
  .extend({
    statut: z.enum(['OUVERT', 'EN_COURS', 'CLOS']).optional(),
  });

/**
 * Séances et procès-verbaux d'une opération.
 *
 * Module `SEANCES` des deux côtés — celui de la société et celui de l'accès à
 * l'opération. La génération du PV écrit bien en GED, mais c'est le service
 * qui le fait sous le contrôle de la route : un intervenant admis aux séances
 * n'a pas besoin d'un droit GED distinct pour obtenir le PV de la sienne.
 */
@RequireModule('SEANCES')
@Controller('operations/:operationId/seances')
export class SeancesController {
  constructor(private readonly seances: SeancesService) {}

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'SEANCES' })
  @Get()
  lister(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Query('statut') statut?: 'PLANIFIEE' | 'TENUE' | 'ANNULEE',
    @Query('type') type?: (typeof TYPES)[number],
  ) {
    return this.seances.lister(operationId, { statut, type });
  }

  /**
   * Actions encore ouvertes sur toute l'opération.
   *
   * Déclarée avant `:seanceId` : Nest apparie dans l'ordre, et « actions »
   * serait sinon interprété comme un identifiant de séance.
   */
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'SEANCES' })
  @Get('actions')
  actions(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.seances.actionsOuvertes(operationId);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'SEANCES' })
  @Get(':seanceId')
  detail(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
  ) {
    return this.seances.detail(operationId, seanceId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Post()
  creer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(seanceSchema)) body: z.infer<typeof seanceSchema>,
  ) {
    return this.seances.creer(operationId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Patch(':seanceId')
  modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
    @Body(new ZodBody(modificationSchema)) body: z.infer<typeof modificationSchema>,
  ) {
    return this.seances.modifier(operationId, seanceId, body);
  }

  // --- Participants -----------------------------------------------------

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Post(':seanceId/participants')
  ajouterParticipant(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
    @Body(new ZodBody(participantSchema)) body: z.infer<typeof participantSchema>,
  ) {
    return this.seances.ajouterParticipant(operationId, seanceId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Delete(':seanceId/participants/:participantId')
  retirerParticipant(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
    @Param('participantId', ParseIntPipe) participantId: number,
  ) {
    return this.seances.retirerParticipant(operationId, seanceId, participantId);
  }

  // --- Points -----------------------------------------------------------

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Post(':seanceId/points')
  ajouterPoint(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
    @Body(new ZodBody(pointSchema)) body: z.infer<typeof pointSchema>,
  ) {
    return this.seances.ajouterPoint(operationId, seanceId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Patch(':seanceId/points/:pointId')
  modifierPoint(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
    @Param('pointId', ParseIntPipe) pointId: number,
    @Body(new ZodBody(modificationPointSchema)) body: z.infer<typeof modificationPointSchema>,
  ) {
    return this.seances.modifierPoint(operationId, seanceId, pointId, body);
  }

  // --- Procès-verbal ----------------------------------------------------

  /** Rédige le PV et le dépose en GED. Rejoué, il produit une nouvelle version. */
  @RequireOperationAccess({ level: 'OPERATE', module: 'SEANCES' })
  @Post(':seanceId/pv')
  @HttpCode(200)
  genererPv(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('seanceId', ParseIntPipe) seanceId: number,
  ) {
    return this.seances.genererPv(operationId, seanceId);
  }
}
