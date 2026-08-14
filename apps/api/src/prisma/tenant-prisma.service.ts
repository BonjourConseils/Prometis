import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { RequestContext } from '../context/request-context';

/** Client Prisma transactionnel sur lequel `app.societe_id` est déjà posé. */
export type TenantDb = Prisma.TransactionClient;

@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exécute `fn` dans une transaction où `app.societe_id` vaut `societeId`.
   *
   * Le réglage est *par connexion*, d'où la transaction : `set_config(..., true)`
   * est l'équivalent de `SET LOCAL`, mais accepte un paramètre lié — on ne
   * concatène jamais l'identifiant dans du SQL, même s'il vient d'une source
   * de confiance.
   *
   * Coût assumé : une transaction par requête tenant. C'est le prix de
   * l'isolation en base plutôt qu'en applicatif.
   */
  async runInTenant<T>(societeId: number, fn: (db: TenantDb) => Promise<T>): Promise<T> {
    if (!Number.isInteger(societeId) || societeId <= 0) {
      throw new Error(`societeId invalide : ${societeId}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.societe_id', ${String(societeId)}, true)`;
      return fn(tx);
    });
  }

  /** Idem, en prenant le tenant du contexte de la requête courante. */
  async run<T>(fn: (db: TenantDb) => Promise<T>): Promise<T> {
    return this.runInTenant(RequestContext.requireSocieteId(), fn);
  }
}
