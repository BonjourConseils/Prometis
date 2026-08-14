import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Client Prisma brut, connecté avec le rôle applicatif (`prometis_app`),
 * donc SOUMIS à la Row-Level Security.
 *
 * Ne pas l'injecter dans un service métier : sans `SET LOCAL app.societe_id`,
 * toutes les tables tenant renverront zéro ligne. Passer par
 * `TenantPrismaService`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
