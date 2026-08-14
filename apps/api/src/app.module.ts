import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { AccesModule } from './acces/acces.module';
import { SocieteModule } from './societe/societe.module';
import { HealthModule } from './health/health.module';
import { OperationsModule } from './operations/operations.module';
import { FoncierModule } from './foncier/foncier.module';
import { ActeursModule } from './acteurs/acteurs.module';
import { BudgetModule } from './budget/budget.module';
import { SoumissionsModule } from './soumissions/soumissions.module';
import { FacturesModule } from './factures/factures.module';
import { VentesModule } from './ventes/ventes.module';
import { PasserelleModule } from './passerelle/passerelle.module';
import { AuthContextMiddleware } from './auth/auth-context.middleware';
import { AuthController } from './auth/auth.controller';
import { AccesController } from './acces/acces.controller';
import { SocieteController } from './societe/societe.controller';
import { OperationsController } from './operations/operations.controller';
import { AuditController } from './audit/audit.controller';
import { MailController } from './mail/mail.controller';
import { FoncierController } from './foncier/foncier.controller';
import { ActeursController, OperationActeursController } from './acteurs/acteurs.controller';
import { BudgetController } from './budget/budget.controller';
import { EntreprisesController, SoumissionsController } from './soumissions/soumissions.controller';
import { FacturesController } from './factures/factures.controller';
import { AcquereursController, VentesController } from './ventes/ventes.controller';
import {
  OperationPasserelleController,
  PasserelleController,
  WebhooksKolabimoController,
} from './passerelle/passerelle.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    MailModule,
    AccesModule,
    SocieteModule,
    HealthModule,
    // Les contrôleurs imbriqués sous `/operations/:operationId` sont
    // enregistrés APRÈS `OperationsModule` : Nest apparie dans l'ordre, et
    // `/operations/:operationId` ne doit pas capter `/operations/1/parcelles`.
    OperationsModule,
    FoncierModule,
    ActeursModule,
    BudgetModule,
    SoumissionsModule,
    FacturesModule,
    VentesModule,
    PasserelleModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * Tout contrôleur exposant des données doit figurer ici : c'est ce
   * middleware qui décode le jeton et pose le contexte de la requête.
   *
   * On énumère plutôt que d'appliquer un joker — d'abord parce que la syntaxe
   * des jokers a changé avec Express 5, ensuite parce que la question « ce
   * contrôleur est-il authentifié ? » mérite d'être posée à chaque ajout.
   *
   * L'oubli ferme l'accès au lieu de l'ouvrir : sans contexte, le garde global
   * répond 401. `HealthController` en est volontairement absent — une sonde de
   * vie ne s'authentifie pas.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthContextMiddleware).forRoutes(
      AuthController,
      SocieteController,
      OperationsController,
      FoncierController,
      ActeursController,
      OperationActeursController,
      BudgetController,
      EntreprisesController,
      SoumissionsController,
      FacturesController,
      AcquereursController,
      VentesController,
      // Le webhook Kolabimo est `@Public()` : il n'a pas de jeton, mais il
      // traverse quand même le middleware, sans quoi aucun contexte de
      // requête n'existerait pour la suite du traitement.
      WebhooksKolabimoController,
      PasserelleController,
      OperationPasserelleController,
      AccesController,
      AuditController,
      MailController,
    );
  }
}
