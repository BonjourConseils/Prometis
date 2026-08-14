import { Module } from '@nestjs/common';
import { EntreprisesController, SoumissionsController } from './soumissions.controller';
import { SoumissionsService } from './soumissions.service';
import { ContratsService } from '../contrats/contrats.service';

/**
 * Soumissions, adjudications et contrats vivent dans le même module : ils
 * forment une seule chaîne métier, et la séparer obligerait à croiser les
 * dépendances pour rien.
 */
@Module({
  controllers: [EntreprisesController, SoumissionsController],
  providers: [SoumissionsService, ContratsService],
})
export class SoumissionsModule {}
