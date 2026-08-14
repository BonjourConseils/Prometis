import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { montantPositif } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { ActeursService } from './acteurs.service';

const TYPES_ACTEUR = [
  'NOTAIRE',
  'GEOMETRE',
  'INGENIEUR',
  'ARCHITECTE',
  'BUREAU_TECHNIQUE',
  'ENTREPRISE_GENERALE',
  'COURTIER',
  'MAITRE_OUVRAGE',
  'PILOTE',
  'AUTRE',
] as const;

const texteOptionnel = z.string().trim().min(1).max(255).nullish();

const acteurSchema = z.object({
  type: z.enum(TYPES_ACTEUR),
  typeLibre: texteOptionnel,
  societeNom: texteOptionnel,
  nom: texteOptionnel,
  prenom: texteOptionnel,
  adresse: texteOptionnel,
  codePostal: texteOptionnel,
  localite: texteOptionnel,
  email: z.string().email('Adresse e-mail invalide.').nullish(),
  telephone: texteOptionnel,
  ide: texteOptionnel,
});

const rattachementSchema = z.object({
  role: z.enum(TYPES_ACTEUR),
  roleLibre: texteOptionnel,
  estMandataireGeneral: z.boolean().optional(),
  suitLeProjet: z.boolean().optional(),
  montantMandat: montantPositif.nullish(),
  ordre: z.number().int().min(0).optional(),
});

/** Annuaire des acteurs de la société. */
@Controller('acteurs')
export class ActeursController {
  constructor(private readonly acteurs: ActeursService) {}

  @RequireModule('ACTEURS')
  @Get()
  lister(@Query('type') type?: string) {
    const filtre = TYPES_ACTEUR.find((t) => t === type);
    return this.acteurs.lister(filtre);
  }

  // L'annuaire est un bien commun de la société : sa tenue relève de
  // l'administration, pas d'un intervenant de passage.
  @RequireModule('ACTEURS')
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Post()
  creer(@Body(new ZodBody(acteurSchema)) body: z.infer<typeof acteurSchema>) {
    return this.acteurs.creer(body);
  }

  @RequireModule('ACTEURS')
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Patch(':acteurId')
  modifier(
    @Param('acteurId', ParseIntPipe) acteurId: number,
    @Body(new ZodBody(acteurSchema.partial())) body: Partial<z.infer<typeof acteurSchema>>,
  ) {
    return this.acteurs.modifier(acteurId, body);
  }
}

/** Rattachement des acteurs à une opération : l'équipe du projet. */
@Controller('operations/:operationId/acteurs')
export class OperationActeursController {
  constructor(private readonly acteurs: ActeursService) {}

  @RequireModule('ACTEURS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'ACTEURS' })
  @Get()
  lister(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.acteurs.listerPourOperation(operationId);
  }

  @RequireModule('ACTEURS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'ACTEURS' })
  @Post(':acteurId')
  rattacher(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('acteurId', ParseIntPipe) acteurId: number,
    @Body(new ZodBody(rattachementSchema)) body: z.infer<typeof rattachementSchema>,
  ) {
    return this.acteurs.rattacher(operationId, acteurId, body);
  }

  @RequireModule('ACTEURS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'ACTEURS' })
  @Delete('rattachements/:rattachementId')
  detacher(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('rattachementId', ParseIntPipe) rattachementId: number,
  ) {
    return this.acteurs.detacher(operationId, rattachementId);
  }
}
