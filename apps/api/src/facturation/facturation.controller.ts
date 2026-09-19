import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { NoWorkspace, Public, Roles } from '../auth/decorators';
import { RequestContext } from '../context/request-context';
import { ZodBody } from '../common/zod-body.pipe';
import { ExploitantGuard } from '../modules/exploitant.guard';
import { FacturationService } from './facturation.service';

const demarrerSchema = z.object({
  modules: z.array(z.string().min(1).max(40)).min(1).max(10),
});
const ajouterSchema = z.object({ prorationDate: z.number().int().positive() });

/**
 * La facturation de ma société. Réservée aux administrateurs : c'est eux qui
 * engagent la dépense, et eux qui reçoivent les avertissements.
 */
@Roles('OWNER', 'ADMIN')
@Controller('facturation')
export class FacturationController {
  constructor(private readonly facturation: FacturationService) {}

  @Get()
  offre() {
    return this.facturation.offre(RequestContext.requireSocieteId());
  }

  @Post('demarrer')
  @HttpCode(200)
  demarrer(@Body(new ZodBody(demarrerSchema)) body: z.infer<typeof demarrerSchema>) {
    return this.facturation.demarrer(
      RequestContext.requireSocieteId(),
      RequestContext.requireCompte().email,
      body.modules,
    );
  }

  @Get('retour')
  retour(@Query('session_id') sessionId: string) {
    return this.facturation.retour(RequestContext.requireSocieteId(), String(sessionId ?? ''));
  }

  @Post('modules/:code/apercu')
  @HttpCode(200)
  apercu(@Param('code') code: string) {
    return this.facturation.apercuAjout(RequestContext.requireSocieteId(), code);
  }

  @Post('modules/:code/ajouter')
  @HttpCode(200)
  ajouter(
    @Param('code') code: string,
    @Body(new ZodBody(ajouterSchema)) body: z.infer<typeof ajouterSchema>,
  ) {
    return this.facturation.ajouter(RequestContext.requireSocieteId(), code, body.prorationDate);
  }

  @Post('modules/:code/resilier')
  @HttpCode(200)
  resilier(@Param('code') code: string) {
    return this.facturation.resilier(RequestContext.requireSocieteId(), code);
  }

  @Post('modules/:code/reprendre')
  @HttpCode(200)
  reprendre(@Param('code') code: string) {
    return this.facturation.reprendre(RequestContext.requireSocieteId(), code);
  }

  @Post('portail')
  @HttpCode(200)
  portail() {
    return this.facturation.portail(RequestContext.requireSocieteId());
  }
}

/**
 * Le webhook Stripe. `@Public` : aucun humain ne l'appelle ; il est
 * authentifié par la signature du corps brut, vérifiée dans le service.
 */
@Controller('webhooks')
export class WebhookStripeController {
  constructor(private readonly facturation: FacturationService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  recevoir(@Req() requete: RawBodyRequest<Request>) {
    return this.facturation.recevoirWebhook(requete.rawBody, requete.header('stripe-signature'));
  }
}

const tarifSchema = z.object({
  prixMensuel: z
    .string()
    .trim()
    .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Montant attendu : « 49 » ou « 49.50 ».')
    .refine((v) => Number(v) > 0, 'Un prix est supérieur à zéro.'),
  stripePriceId: z
    .string()
    .trim()
    .regex(/^price_[A-Za-z0-9]+$/, 'Identifiant Stripe attendu : « price_… ».')
    .nullish()
    .or(z.literal('').transform(() => null)),
});

/** Les prix des modules : catalogue commun, saisi par l'exploitant seul. */
@NoWorkspace()
@UseGuards(ExploitantGuard)
@Controller('exploitant/tarifs')
export class TarifsController {
  constructor(private readonly facturation: FacturationService) {}

  @Get()
  lister() {
    return this.facturation.tarifsPourExploitant();
  }

  @Put(':code')
  fixer(
    @Param('code') code: string,
    @Body(new ZodBody(tarifSchema)) body: z.infer<typeof tarifSchema>,
  ) {
    return this.facturation.fixerTarif(code, body.prixMensuel, body.stripePriceId ?? null);
  }
}
