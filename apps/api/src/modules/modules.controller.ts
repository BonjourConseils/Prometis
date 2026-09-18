import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { NoWorkspace } from '../auth/decorators';
import { RequestContext } from '../context/request-context';
import { ZodBody } from '../common/zod-body.pipe';
import { ModulesService } from './modules.service';
import { ExploitantGuard } from './exploitant.guard';

/** Les modules de ma société : ce que j'ai, ce qui existe, depuis quand. */
@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  etat() {
    return this.modules.etat(RequestContext.requireSocieteId());
  }
}

const changementSchema = z.object({
  statut: z.enum(['ESSAI', 'ACTIF', 'RESILIE']),
  raison: z.string().trim().min(10, 'Une raison d’au moins dix caractères.').max(500),
  finEssai: z.coerce.date().optional(),
});

/**
 * L'espace de l'exploitant : ouvrir, mettre à l'essai, résilier un module.
 *
 * `@NoWorkspace` : l'exploitant n'est membre d'aucune des sociétés qu'il gère,
 * et c'est voulu — il administre des souscriptions, pas des promotions.
 */
@NoWorkspace()
@UseGuards(ExploitantGuard)
@Controller('exploitant')
export class ExploitantController {
  constructor(private readonly modules: ModulesService) {}

  @Get('societes')
  societes() {
    return this.modules.societesPourExploitant();
  }

  @Get('societes/:societeId/modules')
  etat(@Param('societeId', ParseIntPipe) societeId: number) {
    return this.modules.etat(societeId);
  }

  @Post('societes/:societeId/modules/:code')
  @HttpCode(200)
  changer(
    @Param('societeId', ParseIntPipe) societeId: number,
    @Param('code') code: string,
    @Body(new ZodBody(changementSchema)) body: z.infer<typeof changementSchema>,
  ) {
    return this.modules.changer(societeId, code, body.statut, {
      source: 'ADMIN',
      raison: body.raison,
      finEssai: body.finEssai,
      parCompteId: RequestContext.requireCompte().compteId,
    });
  }
}
