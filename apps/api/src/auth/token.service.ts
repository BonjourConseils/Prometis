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
  /**
   * `defi` marque le jeton délivré entre le mot de passe et le second
   * facteur. Il n'ouvre **rien** : le middleware de contexte le rejette comme
   * un jeton invalide, et seul l'endpoint de vérification MFA le lit.
   */
  typ?: 'defi';
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  /** Jeton d'identité, sans espace de travail. */
  signCompte(compte: AuthenticatedCompte): string {
    return this.jwt.sign({ sub: compte.compteId, email: compte.email } satisfies TokenPayload);
  }

  /**
   * Jeton de défi : le mot de passe est vérifié, le second facteur ne l'est
   * pas encore.
   *
   * Durée volontairement courte. Il ne donne accès à aucune route — sa seule
   * valeur est de prouver, à l'étape suivante, de quel compte il s'agit sans
   * refaire circuler le mot de passe.
   */
  signDefiMfa(compte: AuthenticatedCompte, dureeDeVie: string): string {
    return this.jwt.sign(
      { sub: compte.compteId, email: compte.email, typ: 'defi' } satisfies TokenPayload,
      { expiresIn: dureeDeVie as never },
    );
  }

  /**
   * Lit un jeton de défi, et refuse tout le reste.
   *
   * L'inverse compte autant : `verify()` refuse un jeton de défi, de sorte
   * qu'un jeton obtenu avant le second facteur ne puisse servir nulle part.
   */
  verifyDefiMfa(token: string): TokenPayload {
    const payload = this.decode(token);
    if (payload.typ !== 'defi') {
      throw new UnauthorizedException('Jeton de défi attendu.');
    }
    return payload;
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
    const payload = this.decode(token);
    if (payload.typ === 'defi') {
      // Un jeton de défi présenté comme jeton d'identité : refusé sans
      // ambiguïté. C'est le point qui empêche de contourner le second facteur.
      throw new UnauthorizedException('Second facteur non vérifié.');
    }
    return payload;
  }

  private decode(token: string): TokenPayload {
    try {
      return this.jwt.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré.');
    }
  }
}
