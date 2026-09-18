import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext, type RequestStore } from '../context/request-context';
import { loadEnv } from '../config/env';
import { ipClient } from '../securite/ip-client';
import { TokenService } from './token.service';

const env = loadEnv();

/**
 * Pose le contexte de la requête à partir du jeton.
 *
 * C'est un *middleware* et pas un guard parce qu'`AsyncLocalStorage.run()`
 * doit envelopper toute la suite du traitement : un guard ne peut pas le faire,
 * il ne fait que répondre oui ou non.
 *
 * Remplace l'en-tête `x-societe-id` du Lot 0 : le tenant vient désormais d'un
 * jeton signé, vérifié contre le `Membership` au moment où l'espace de travail
 * a été choisi.
 */
@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const store: RequestStore = {
      ip: ipClient({
        ipConnexion: req.socket.remoteAddress,
        entetes: req.headers,
        secretRelais: env.RELAIS_SECRET,
      }),
      // Le relais réécrit `user-agent` avec celui du navigateur ; c'est une
      // indication pour le journal, pas une preuve, donc sans secret requis.
      userAgent: req.header('user-agent')?.slice(0, 200),
    };
    const header = req.header('authorization');

    if (header?.startsWith('Bearer ')) {
      // Jeton présent mais invalide → 401 immédiat. Le laisser passer en
      // anonyme donnerait un 403 trompeur sur une route protégée.
      const payload = this.tokens.verify(header.slice('Bearer '.length).trim());

      store.compte = { compteId: payload.sub, email: payload.email };

      if (payload.sid !== undefined && payload.mid !== undefined && payload.role !== undefined) {
        store.workspace = {
          societeId: payload.sid,
          membershipId: payload.mid,
          role: payload.role,
        };
      }
    }

    RequestContext.run(store, () => next());
  }
}
