import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { RequestContext } from '../context/request-context';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { NoWorkspace, Public } from './decorators';

const loginSchema = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  motDePasse: z.string().min(1, 'Mot de passe requis.'),
});

const workspaceSchema = z.object({
  societeId: z.number().int().positive(),
});

/** Un code TOTP fait 6 chiffres ; un code de secours ressemble à « a3f9-2k7p ». */
const codeSchema = z.object({
  code: z.string().trim().min(6, 'Code requis.').max(20),
});

const mfaSchema = codeSchema.extend({
  defiToken: z.string().min(1, 'Jeton de défi requis.'),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodBody(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.motDePasse);
  }

  /**
   * Second temps de la connexion, quand le compte porte un second facteur.
   *
   * `@Public()` parce que le porteur n'a pas encore de jeton d'identité — il
   * n'a qu'un jeton de défi, qui n'ouvre aucune autre route.
   */
  @Public()
  @Post('mfa/verifier')
  @HttpCode(200)
  async verifierMfa(@Body(new ZodBody(mfaSchema)) body: z.infer<typeof mfaSchema>) {
    return this.auth.verifierMfa(body.defiToken, body.code);
  }

  // --- Gestion du second facteur, sur son propre compte -----------------

  @NoWorkspace()
  @Get('mfa')
  async etatMfa() {
    return this.mfa.etat(RequestContext.requireCompte().compteId);
  }

  /** Produit le secret à scanner. Il n'est PAS actif tant qu'il n'est pas confirmé. */
  @NoWorkspace()
  @Post('mfa/enrolement')
  @HttpCode(200)
  async enroler() {
    return this.mfa.commencerEnrolement(RequestContext.requireCompte().compteId);
  }

  /** Confirme l'enrôlement et rend les codes de secours — une seule fois. */
  @NoWorkspace()
  @Post('mfa/activer')
  @HttpCode(200)
  async activerMfa(@Body(new ZodBody(codeSchema)) body: z.infer<typeof codeSchema>) {
    return this.mfa.activer(RequestContext.requireCompte().compteId, body.code);
  }

  /** Désactive le second facteur. Un code valide est exigé, pas seulement la session. */
  @NoWorkspace()
  @Delete('mfa')
  async desactiverMfa(@Body(new ZodBody(codeSchema)) body: z.infer<typeof codeSchema>) {
    return this.mfa.desactiver(RequestContext.requireCompte().compteId, body.code);
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
