import {
  Body,
  Controller,
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
import { montantPositif, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { VentesService } from './ventes.service';
import { AppelsDeFondsService } from '../appels-de-fonds/appels-de-fonds.service';

const texteOptionnel = z.string().trim().min(1).max(500).nullish();

const acquereurSchema = z.object({
  nom: texteOptionnel,
  prenom: texteOptionnel,
  email: z.string().email('Adresse e-mail invalide.').nullish(),
  telephone: texteOptionnel,
  adresse: texteOptionnel,
});

const reservationSchema = z.object({
  lotId: z.number().int().positive(),
  acquereurId: z.number().int().positive(),
  statut: z.enum(['OPTION', 'RESERVE', 'FONDS_VERSES', 'VENDU', 'EXPIREE', 'ANNULEE']).optional(),
  // Omettre pour laisser calculer prix du lot + Σ parkings.
  prixTotalActe: montantPositif.nullish(),
  dateReservation: z.coerce.date().optional(),
  dateSignatureActe: z.coerce.date().nullish(),
  notaireActeurId: z.number().int().positive().nullish(),
  externalId: z.string().trim().max(120).nullish(),
});

const etapeSchema = z.object({
  ordre: z.number().int().min(1).max(100),
  libelle: z.string().trim().min(1, 'Libellé requis.').max(200),
  description: texteOptionnel,
  // `null` = jalon de suivi de chantier : aucun appel de fonds n'en découle.
  pourcentage: nombreDecimal.nullish(),
  datePrevue: z.coerce.date().nullish(),
});

const declenchementSchema = z.object({
  dateCompletion: z.coerce.date().optional(),
  /** Passer à false pour générer sans envoyer — utile en reprise de données. */
  envoyer: z.boolean().optional(),
});

const encaissementSchema = z.object({
  montant: montantPositif,
  dateValeur: z.coerce.date(),
  reference: texteOptionnel,
  source: z.string().trim().max(40).nullish(),
});

/** Acquéreurs — au niveau de la société, comme les autres répertoires. */
@RequireModule('ACQUEREURS')
@Controller('acquereurs')
export class AcquereursController {
  constructor(private readonly ventes: VentesService) {}

  @Get()
  lister() {
    return this.ventes.listerAcquereurs();
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMMERCIAL')
  @Post()
  creer(@Body(new ZodBody(acquereurSchema)) body: z.infer<typeof acquereurSchema>) {
    return this.ventes.creerAcquereur(body);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMMERCIAL')
  @Patch(':acquereurId')
  modifier(
    @Param('acquereurId', ParseIntPipe) acquereurId: number,
    @Body(new ZodBody(acquereurSchema.partial())) body: Partial<z.infer<typeof acquereurSchema>>,
  ) {
    return this.ventes.modifierAcquereur(acquereurId, body);
  }
}

/** Ventes et appels de fonds d'une opération. */
@Controller('operations/:operationId')
export class VentesController {
  constructor(
    private readonly ventes: VentesService,
    private readonly appels: AppelsDeFondsService,
  ) {}

  // --- Réservations -----------------------------------------------------

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'VENTES' })
  @Get('reservations')
  listerReservations(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.ventes.listerReservations(operationId);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Post('reservations')
  creerReservation(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(reservationSchema)) body: z.infer<typeof reservationSchema>,
  ) {
    return this.ventes.creerReservation(operationId, body);
  }

  @RequireModule('LOTS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'VENTES' })
  @Patch('reservations/:reservationId')
  modifierReservation(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body(new ZodBody(reservationSchema.partial()))
    body: Partial<z.infer<typeof reservationSchema>>,
  ) {
    return this.ventes.modifierReservation(operationId, reservationId, body);
  }

  // --- Échéancier -------------------------------------------------------

  @RequireModule('ECHEANCIER')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'APPELS_FONDS' })
  @Get('echeancier')
  listerEtapes(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.ventes.listerEtapes(operationId);
  }

  @RequireModule('ECHEANCIER')
  @RequireOperationAccess({ level: 'MANAGE', module: 'APPELS_FONDS' })
  @Post('echeancier')
  creerEtape(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(etapeSchema)) body: z.infer<typeof etapeSchema>,
  ) {
    return this.ventes.creerEtape(operationId, body);
  }

  @RequireModule('ECHEANCIER')
  @RequireOperationAccess({ level: 'MANAGE', module: 'APPELS_FONDS' })
  @Patch('echeancier/:etapeId')
  modifierEtape(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('etapeId', ParseIntPipe) etapeId: number,
    @Body(new ZodBody(etapeSchema.omit({ ordre: true }).partial()))
    body: Partial<Omit<z.infer<typeof etapeSchema>, 'ordre'>>,
  ) {
    return this.ventes.modifierEtape(operationId, etapeId, body);
  }

  @RequireModule('ECHEANCIER')
  @RequireOperationAccess({ level: 'OPERATE', module: 'APPELS_FONDS' })
  @Post('echeancier/:etapeId/avancement')
  @HttpCode(200)
  changerAvancement(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('etapeId', ParseIntPipe) etapeId: number,
    @Body(new ZodBody(z.object({ statut: z.enum(['NOT_STARTED', 'IN_PROGRESS']) })))
    body: { statut: 'NOT_STARTED' | 'IN_PROGRESS' },
  ) {
    return this.ventes.changerAvancement(operationId, etapeId, body.statut);
  }

  // --- Le moteur --------------------------------------------------------

  /**
   * Marque un jalon terminé et génère les appels de fonds.
   *
   * Idempotent : rejouer ne crée rien. MANAGE requis — la décision engage la
   * facturation de tous les acquéreurs de l'opération.
   */
  @RequireModule('APPELS_FONDS')
  @RequireOperationAccess({ level: 'MANAGE', module: 'APPELS_FONDS' })
  @Post('echeancier/:etapeId/declencher')
  @HttpCode(200)
  declencher(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('etapeId', ParseIntPipe) etapeId: number,
    @Body(new ZodBody(declenchementSchema)) body: z.infer<typeof declenchementSchema>,
  ) {
    return this.appels.declencherEtape(operationId, etapeId, body);
  }

  // --- Appels de fonds --------------------------------------------------

  @RequireModule('APPELS_FONDS')
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'APPELS_FONDS' })
  @Get('appels-de-fonds')
  listerAppels(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Query('enRetard') enRetard?: string,
  ) {
    return this.appels.lister(operationId, { enRetard: enRetard === 'true' });
  }

  @RequireModule('APPELS_FONDS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'APPELS_FONDS' })
  @Post('appels-de-fonds/:appelId/encaissements')
  encaisser(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('appelId', ParseIntPipe) appelId: number,
    @Body(new ZodBody(encaissementSchema)) body: z.infer<typeof encaissementSchema>,
  ) {
    return this.appels.enregistrerEncaissement(operationId, appelId, body);
  }

  @RequireModule('APPELS_FONDS')
  @RequireOperationAccess({ level: 'OPERATE', module: 'APPELS_FONDS' })
  @Post('appels-de-fonds/:appelId/relance')
  @HttpCode(200)
  relancer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('appelId', ParseIntPipe) appelId: number,
  ) {
    return this.appels.relancer(operationId, appelId);
  }
}
