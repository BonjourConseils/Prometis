import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequireModule, Roles } from '../auth/decorators';
import { RechercheWebService } from './recherche-web.service';

const siteSchema = z.object({ url: z.string().trim().min(3).max(300) });

/**
 * Préremplir une fiche depuis un site web.
 *
 * Tenir l'annuaire relève de l'administration : mêmes rôles que la création
 * d'un acteur. Rien n'est enregistré ici — la réponse remplit un formulaire
 * que quelqu'un relit et valide.
 */
@RequireModule('ACTEURS')
@Roles('OWNER', 'ADMIN', 'CHEF_PROJET')
@Controller('recherche')
export class RechercheController {
  constructor(private readonly recherche: RechercheWebService) {}

  @Get('disponibilite')
  disponibilite() {
    return { rechercheWeb: this.recherche.rechercheWebDisponible };
  }

  @Post('site-web')
  @HttpCode(200)
  siteWeb(@Body(new ZodBody(siteSchema)) body: z.infer<typeof siteSchema>) {
    return this.recherche.depuisSiteWeb(body.url);
  }
}
