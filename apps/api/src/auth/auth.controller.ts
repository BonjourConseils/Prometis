import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequestContext } from '../context/request-context';
import { AuthService } from './auth.service';
import { NoWorkspace, Public } from './decorators';

const loginSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  motDePasse: z.string().min(1, 'Mot de passe requis.'),
});

const workspaceSchema = z.object({
  societeId: z.number().int().positive(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodBody(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.motDePasse);
  }

  /** Le sélecteur d'espace de travail : accessible avec le seul jeton d'identité. */
  @NoWorkspace()
  @Get('workspaces')
  async workspaces() {
    const compte = RequestContext.requireCompte();
    return this.auth.workspacesDe(compte.compteId);
  }

  @NoWorkspace()
  @Post('workspace')
  @HttpCode(200)
  async choisirWorkspace(
    @Body(new ZodBody(workspaceSchema)) body: z.infer<typeof workspaceSchema>,
  ) {
    return this.auth.choisirWorkspace(RequestContext.requireCompte(), body.societeId);
  }

  @NoWorkspace()
  @Get('me')
  async me() {
    return this.auth.me();
  }
}
