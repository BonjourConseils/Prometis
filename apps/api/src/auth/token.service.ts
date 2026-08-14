import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UtilisateurRole } from '@prisma/client';
import type { AuthenticatedCompte, Workspace } from '../context/request-context';

/**
 * Contenu du jeton. Deux formes :
 *   · sans `sid` — le compte est authentifié mais n'a pas choisi d'espace ;
 *     il ne peut appeler que les routes @NoWorkspace (dont le sélecteur).
 *   · avec `sid` — un espace de travail est choisi ; c'est ce jeton qui
 *     détermine `app.societe_id` pour chaque requête.
 *
 * Le rôle est dans le jeton pour éviter une requête par appel, mais il n'est
 * jamais la seule barrière : les données restent protégées par la RLS, et les
 * droits par opération sont relus en base.
 */
export interface TokenPayload {
  sub: number;
  email: string;
  sid?: number;
  mid?: number;
  role?: UtilisateurRole;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  /** Jeton d'identité, sans espace de travail. */
  signCompte(compte: AuthenticatedCompte): string {
    return this.jwt.sign({ sub: compte.compteId, email: compte.email } satisfies TokenPayload);
  }

  /** Jeton portant l'espace de travail choisi. */
  signWorkspace(compte: AuthenticatedCompte, workspace: Workspace): string {
    return this.jwt.sign({
      sub: compte.compteId,
      email: compte.email,
      sid: workspace.societeId,
      mid: workspace.membershipId,
      role: workspace.role,
    } satisfies TokenPayload);
  }

  verify(token: string): TokenPayload {
    try {
      return this.jwt.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré.');
    }
  }
}
