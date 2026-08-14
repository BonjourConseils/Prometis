import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequireModule, Roles } from '../auth/decorators';
import { RequestContext } from '../context/request-context';
import { PasserelleService } from './passerelle.service';
import { ENTETE_CLE_API, ENTETE_SIGNATURE } from './signature';

/**
 * Webhooks entrants de Kolabimo.
 *
 * `@Public()` ne veut pas dire « ouvert » : la route n'est pas authentifiée par
 * un jeton *parce qu'aucun humain ne l'appelle*. Elle l'est par la clé d'API et
 * la signature HMAC du corps, vérifiées dans le service. Les garder ensemble
 * ici plutôt que dans un guard rend la chose lisible : c'est le seul endroit du
 * produit où l'authentification n'est pas celle de tout le monde.
 */
@Controller('webhooks')
export class WebhooksKolabimoController {
  constructor(private readonly passerelle: PasserelleService) {}

  @Public()
  @Post('kolabimo')
  @HttpCode(200)
  recevoir(@Req() requete: RawBodyRequest<Request>) {
    // Le corps BRUT, pas l'objet analysé : la signature porte sur les octets
    // reçus. Re-sérialiser l'objet donnerait un autre texte, donc une autre
    // empreinte, et toute signature valide serait rejetée.
    const corpsBrut = requete.rawBody?.toString('utf8');
    if (corpsBrut === undefined) {
      throw new BadRequestException(
        'Corps brut indisponible : `rawBody` doit être activé au démarrage.',
      );
    }

    return this.passerelle.recevoir({
      cleApi: requete.header(ENTETE_CLE_API),
      signature: requete.header(ENTETE_SIGNATURE),
      corpsBrut,
    });
  }
}

const filtreJournal = z.object({
  statut: z.enum(['RECU', 'TRAITE', 'IGNORE', 'ERREUR']).optional(),
  source: z.enum(['kolabimo', 'prometis']).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Surface d'administration de la passerelle : état, journal, rejeu.
 *
 * Aucun `RequireModule` : la synchronisation n'est pas un module métier, c'est
 * de l'exploitation. Le rôle suffit à en borner l'accès.
 */
@Controller('passerelle')
export class PasserelleController {
  constructor(private readonly passerelle: PasserelleService) {}

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Get('etat')
  etat() {
    return this.passerelle.etat(RequestContext.requireSocieteId());
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Get('journal')
  journal(@Query() query: unknown) {
    const filtre = filtreJournal.parse(query ?? {});
    return this.passerelle.journal(RequestContext.requireSocieteId(), filtre);
  }

  /**
   * Rejoue un événement : retraite un entrant, relivre un sortant.
   *
   * Réservé aux administrateurs — rejouer un entrant réapplique des données
   * financières, relivrer un sortant reparle à Kolabimo.
   */
  @Roles('OWNER', 'ADMIN')
  @Post('journal/:evenementId/rejouer')
  @HttpCode(200)
  rejouer(@Param('evenementId', ParseIntPipe) evenementId: number) {
    return this.passerelle.rejouer(RequestContext.requireSocieteId(), evenementId);
  }
}

/** Synchronisation d'une opération avec sa promotion Kolabimo. */
@Controller('operations/:operationId/passerelle')
export class OperationPasserelleController {
  constructor(private readonly passerelle: PasserelleService) {}

  /**
   * Reprise complète des réservations depuis Kolabimo.
   *
   * Les webhooks suffisent au fil de l'eau, mais pas au premier raccordement,
   * ni après une coupure : ce tirage rejoue l'existant. Il passe par le même
   * chemin de réconciliation que les webhooks — donc les mêmes verrous sur le
   * prix figé — et il est idempotent par construction.
   */
  @RequireModule('LOTS')
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Post('importer-reservations')
  @HttpCode(200)
  importerReservations(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.passerelle.importerReservations(RequestContext.requireSocieteId(), operationId);
  }
}
