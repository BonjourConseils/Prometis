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
import { montant, montantPositif, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { SoumissionsService } from './soumissions.service';
import { ContratsService } from '../contrats/contrats.service';

const texteOptionnel = z.string().trim().min(1).max(500).nullish();

const entrepriseSchema = z.object({
  nom: z.string().trim().min(1, "Nom de l'entreprise requis.").max(200),
  corpsMetier: texteOptionnel,
  contactNom: texteOptionnel,
  email: z.string().email('Adresse e-mail invalide.').nullish(),
  telephone: texteOptionnel,
  ide: texteOptionnel,
});

const soumissionSchema = z.object({
  cfcNodeId: z.number().int().positive().nullish(),
  intitule: z.string().trim().min(1, 'Intitulé requis.').max(200),
  corpsMetier: texteOptionnel,
  statut: z
    .enum([
      'BROUILLON',
      'ENVOYEE',
      'OUVERTE',
      'EN_COMPARAISON',
      'ADJUGEE',
      'INFRUCTUEUSE',
      'ANNULEE',
    ])
    .optional(),
  dateEnvoi: z.coerce.date().nullish(),
  dateLimite: z.coerce.date().nullish(),
});

const offreSchema = z.object({
  entrepriseId: z.number().int().positive(),
  montant: montantPositif.nullish(),
  remisePct: nombreDecimal.nullish(),
  statut: z.enum(['ATTENDUE', 'RECUE', 'RELANCE', 'RETENUE', 'ECARTEE']).optional(),
  dateReception: z.coerce.date().nullish(),
  note: texteOptionnel,
});

const adjudicationSchema = z.object({
  offreId: z.number().int().positive(),
  commentaire: texteOptionnel,
});

const contratSchema = z.object({
  reference: texteOptionnel,
  retenueGarantiePct: nombreDecimal.nullish(),
  dateSignature: z.coerce.date().nullish(),
});

const modifierContratSchema = z
  .object({
    reference: texteOptionnel,
    retenueGarantiePct: nombreDecimal.nullish(),
    statut: z.enum(['BROUILLON', 'SIGNE', 'EN_COURS', 'RECEPTION', 'SOLDE', 'RESILIE']).optional(),
    dateSignature: z.coerce.date().nullish(),
    dateReception: z.coerce.date().nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun changement fourni.' });

const avenantSchema = z.object({
  cfcNodeId: z.number().int().positive().nullish(),
  reference: texteOptionnel,
  // Signé : un travail en moins s'enregistre négatif.
  montant: montant,
  motif: texteOptionnel,
  // Non nullable en base : omettre laisse la date du jour.
  dateAvenant: z.coerce.date().optional(),
});

/** Répertoire des entreprises — au niveau de la société. */
@RequireModule('SOUMISSIONS')
@Controller('entreprises')
export class EntreprisesController {
  constructor(private readonly soumissions: SoumissionsService) {}

  @Get()
  lister(@Query('corpsMetier') corpsMetier?: string) {
    return this.soumissions.listerEntreprises(corpsMetier?.trim() || undefined);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'ECONOMISTE')
  @Post()
  creer(@Body(new ZodBody(entrepriseSchema)) body: z.infer<typeof entrepriseSchema>) {
    return this.soumissions.creerEntreprise(body);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'ECONOMISTE')
  @Patch(':entrepriseId')
  modifier(
    @Param('entrepriseId', ParseIntPipe) entrepriseId: number,
    @Body(new ZodBody(entrepriseSchema.partial())) body: Partial<z.infer<typeof entrepriseSchema>>,
  ) {
    return this.soumissions.modifierEntreprise(entrepriseId, body);
  }
}

/** Soumissions, offres, adjudications et contrats d'une opération. */
@Controller('operations/:operationId')
export class SoumissionsController {
  constructor(
    private readonly soumissions: SoumissionsService,
    private readonly contrats: ContratsService,
  ) {}

  // --- Soumissions -----------------------------------------------------

  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'SOUMISSIONS' })
  @Get('soumissions')
  lister(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.soumissions.listerSoumissions(operationId);
  }

  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'SOUMISSIONS' })
  @Post('soumissions')
  creer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(soumissionSchema)) body: z.infer<typeof soumissionSchema>,
  ) {
    return this.soumissions.creerSoumission(operationId, body);
  }

  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'SOUMISSIONS' })
  @Patch('soumissions/:soumissionId')
  modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('soumissionId', ParseIntPipe) soumissionId: number,
    @Body(new ZodBody(soumissionSchema.partial())) body: Partial<z.infer<typeof soumissionSchema>>,
  ) {
    return this.soumissions.modifierSoumission(operationId, soumissionId, body);
  }

  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'SOUMISSIONS' })
  @Post('soumissions/:soumissionId/invitations/:entrepriseId')
  @HttpCode(200)
  inviter(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('soumissionId', ParseIntPipe) soumissionId: number,
    @Param('entrepriseId', ParseIntPipe) entrepriseId: number,
  ) {
    return this.soumissions.inviter(operationId, soumissionId, entrepriseId);
  }

  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'SOUMISSIONS' })
  @Post('soumissions/:soumissionId/offres')
  @HttpCode(200)
  enregistrerOffre(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('soumissionId', ParseIntPipe) soumissionId: number,
    @Body(new ZodBody(offreSchema)) body: z.infer<typeof offreSchema>,
  ) {
    return this.soumissions.enregistrerOffre(operationId, soumissionId, body);
  }

  /** Écran « Comparaison des offres ». */
  @RequireModule('SOUMISSIONS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'SOUMISSIONS' })
  @Get('soumissions/:soumissionId/comparaison')
  comparaison(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('soumissionId', ParseIntPipe) soumissionId: number,
  ) {
    return this.soumissions.comparaison(operationId, soumissionId);
  }

  // --- Adjudication -----------------------------------------------------

  // Adjuger engage la société : c'est un geste de gestion, pas de saisie.
  @RequireModule('ADJUDICATIONS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'SOUMISSIONS' })
  @Post('soumissions/:soumissionId/adjudication')
  adjuger(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('soumissionId', ParseIntPipe) soumissionId: number,
    @Body(new ZodBody(adjudicationSchema)) body: z.infer<typeof adjudicationSchema>,
  ) {
    return this.contrats.adjuger(operationId, soumissionId, body);
  }

  @RequireModule('ADJUDICATIONS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'SOUMISSIONS' })
  @Delete('adjudications/:adjudicationId')
  annulerAdjudication(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('adjudicationId', ParseIntPipe) adjudicationId: number,
  ) {
    return this.contrats.annulerAdjudication(operationId, adjudicationId);
  }

  // --- Contrats ---------------------------------------------------------

  @RequireModule('CONTRATS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'CONTRATS' })
  @Get('contrats')
  listerContrats(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.contrats.listerContrats(operationId);
  }

  @RequireModule('CONTRATS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'CONTRATS' })
  @Post('adjudications/:adjudicationId/contrat')
  creerContrat(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('adjudicationId', ParseIntPipe) adjudicationId: number,
    @Body(new ZodBody(contratSchema)) body: z.infer<typeof contratSchema>,
  ) {
    return this.contrats.creerContratDepuisAdjudication(operationId, adjudicationId, body);
  }

  @RequireModule('CONTRATS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'CONTRATS' })
  @Patch('contrats/:contratId')
  modifierContrat(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('contratId', ParseIntPipe) contratId: number,
    @Body(new ZodBody(modifierContratSchema)) body: z.infer<typeof modifierContratSchema>,
  ) {
    return this.contrats.modifierContrat(operationId, contratId, body);
  }

  // --- Avenants ---------------------------------------------------------

  @RequireModule('CONTRATS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'CONTRATS' })
  @Post('contrats/:contratId/avenants')
  creerAvenant(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('contratId', ParseIntPipe) contratId: number,
    @Body(new ZodBody(avenantSchema)) body: z.infer<typeof avenantSchema>,
  ) {
    return this.contrats.creerAvenant(operationId, contratId, body);
  }

  @RequireModule('CONTRATS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'CONTRATS' })
  @Delete('avenants/:avenantId')
  supprimerAvenant(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('avenantId', ParseIntPipe) avenantId: number,
  ) {
    return this.contrats.supprimerAvenant(operationId, avenantId);
  }
}
