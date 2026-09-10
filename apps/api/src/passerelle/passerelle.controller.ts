import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public, RequireModule, Roles } from '../auth/decorators';
import { RequestContext } from '../context/request-context';
import { PasserelleService } from './passerelle.service';
import { ConnexionKolabimoService } from './connexion-kolabimo.service';
import { SynchronisationKolabimoService } from './synchronisation-kolabimo.service';
import { ZodBody } from '../common/zod-body.pipe';
import { ENTETE_CLE_API, ENTETE_SIGNATURE } from './signature';
import { ENTETE_EVENEMENT, ENTETE_LIVRAISON } from './contrat-kolabimo';

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

    // Le contrat Kolabimo nomme l'événement et sa clé de déduplication dans
    // les en-têtes, pas dans le corps. Ils priment quand ils sont là : c'est
    // `X-Kolabimo-Delivery` que Kolabimo promet unique par événement.
    return this.passerelle.recevoir({
      cleApi: requete.header(ENTETE_CLE_API),
      signature: requete.header(ENTETE_SIGNATURE),
      evenement: requete.header(ENTETE_EVENEMENT),
      livraison: requete.header(ENTETE_LIVRAISON),
      corpsBrut,
    });
  }

  /**
   * Le point d'entrée du **contrat Kolabimo** — celui qu'on colle dans
   * Kolabimo, « Ma société → Intégrations & API ».
   *
   * Kolabimo n'envoie pas de clé d'API : trois en-têtes, et c'est tout. Le
   * jeton de l'URL désigne la société ; la signature, calculée avec le secret
   * de webhook de cette société, authentifie. Un jeton seul ne donne rien :
   * sans le secret, aucune signature ne passe.
   */
  @Public()
  @Post('kolabimo/:jeton')
  @HttpCode(200)
  recevoirKolabimo(@Req() requete: RawBodyRequest<Request>, @Param('jeton') jeton: string) {
    const corpsBrut = requete.rawBody?.toString('utf8');
    if (corpsBrut === undefined) {
      throw new BadRequestException(
        'Corps brut indisponible : `rawBody` doit être activé au démarrage.',
      );
    }
    return this.passerelle.recevoir({
      jeton,
      signature: requete.header(ENTETE_SIGNATURE),
      evenement: requete.header(ENTETE_EVENEMENT),
      livraison: requete.header(ENTETE_LIVRAISON),
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
  constructor(private readonly synchro: SynchronisationKolabimoService) {}

  /**
   * Reprise complète depuis Kolabimo : lots, parkings, échéancier,
   * réservations.
   *
   * Les webhooks tiennent le fil de l'eau, pas le premier raccordement ni ce
   * qui s'est passé pendant une coupure — Kolabimo ne réessaie pas. Ce tirage
   * rejoue l'existant, par le même chemin que les webhooks, et il est
   * idempotent : rejouer met à jour, ne duplique pas.
   */
  @RequireModule('LOTS')
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Post('synchroniser')
  @HttpCode(200)
  synchroniser(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.synchro.synchroniser(RequestContext.requireSocieteId(), operationId);
  }
}

const connexionSchema = z.object({
  baseUrl: z.string().trim().max(200).optional(),
  cleApi: z.string().trim().min(20, 'Clé Kolabimo trop courte.').max(200),
});

const rattachementSchema = z.object({
  /** Absent : une opération est créée d'après la promotion. */
  operationId: z.number().int().positive().optional(),
});

/**
 * La connexion de la société à SON compte Kolabimo, et la lecture de ses
 * promotions.
 *
 * Enregistrer ou retirer une clé est réservé à OWNER et ADMIN : la clé ouvre
 * toutes les promotions du promoteur. Lire les promotions l'est aussi au chef
 * de projet — c'est lui qui prépare le rattachement.
 */
@Controller('passerelle/kolabimo')
export class KolabimoController {
  constructor(
    private readonly connexions: ConnexionKolabimoService,
    private readonly synchro: SynchronisationKolabimoService,
  ) {}

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Get()
  etat() {
    return this.connexions.etat(RequestContext.requireSocieteId());
  }

  /**
   * Enregistre la clé, après l'avoir essayée. La réponse porte le secret de
   * webhook **à la création seulement** — c'est l'unique moment où il sort.
   */
  @Roles('OWNER', 'ADMIN')
  @Put()
  enregistrer(@Body(new ZodBody(connexionSchema)) body: z.infer<typeof connexionSchema>) {
    return this.connexions.enregistrer(RequestContext.requireSocieteId(), body);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('tester')
  @HttpCode(200)
  tester() {
    return this.connexions.tester(RequestContext.requireSocieteId());
  }

  @Roles('OWNER', 'ADMIN')
  @Post('secret')
  @HttpCode(200)
  regenererSecret() {
    return this.connexions.regenererSecret(RequestContext.requireSocieteId());
  }

  @Roles('OWNER', 'ADMIN')
  @Delete()
  @HttpCode(200)
  async supprimer() {
    await this.connexions.supprimer(RequestContext.requireSocieteId());
    return { supprimee: true };
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Get('promotions')
  promotions() {
    return this.synchro.promotions(RequestContext.requireSocieteId());
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
  @Get('promotions/:promotionId')
  photo(@Param('promotionId', ParseIntPipe) promotionId: number) {
    return this.synchro.photo(RequestContext.requireSocieteId(), promotionId);
  }

  /**
   * Rattache la promotion à une opération — ou en crée une — et la
   * synchronise. OWNER et ADMIN : le geste peut créer une opération, et il
   * ouvre la facturation des acquéreurs de la promotion.
   */
  @RequireModule('LOTS')
  @Roles('OWNER', 'ADMIN')
  @Post('promotions/:promotionId/rattacher')
  @HttpCode(200)
  rattacher(
    @Param('promotionId', ParseIntPipe) promotionId: number,
    @Body(new ZodBody(rattachementSchema)) body: z.infer<typeof rattachementSchema>,
  ) {
    return this.synchro.rattacher(RequestContext.requireSocieteId(), promotionId, body);
  }
}
