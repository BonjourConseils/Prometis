import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EntreprisesController, SoumissionsController } from './soumissions.controller';
import { SoumissionsService } from './soumissions.service';
import { ContratsService } from '../contrats/contrats.service';
import { ConsultationService } from './consultation.service';
import { EspaceEntrepriseService } from './espace-entreprise.service';
import { EspaceEntrepriseController } from './espace-entreprise.controller';
import { IaService } from '../ia/ia.service';
import { FacturesModule } from '../factures/factures.module';
import { GedModule } from '../ged/ged.module';

/**
 * Soumissions, adjudications et contrats vivent dans le même module : ils
 * forment une seule chaîne métier, et la séparer obligerait à croiser les
 * dépendances pour rien. L'espace entreprise en fait partie : c'est la même
 * consultation, vue de l'autre côté.
 */
@Module({
  imports: [
    FacturesModule,
    GedModule,
    // Une instance à part pour les sessions de l'espace entreprise : aucun
    // secret par défaut (le service passe le sien, dérivé), un émetteur
    // distinct. Rien de ce qu'elle signe ne passe pour une session Prometis.
    JwtModule.register({
      signOptions: { issuer: 'prometis-consultation' },
      verifyOptions: { issuer: 'prometis-consultation' },
    }),
  ],
  controllers: [EntreprisesController, SoumissionsController, EspaceEntrepriseController],
  providers: [
    SoumissionsService,
    ContratsService,
    ConsultationService,
    EspaceEntrepriseService,
    IaService,
  ],
  exports: [ConsultationService],
})
export class SoumissionsModule {}
