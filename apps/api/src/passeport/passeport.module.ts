import { Module } from '@nestjs/common';
import { PasseportController } from './passeport.controller';
import { PasseportService } from './passeport.service';
import { IaService } from '../ia/ia.service';
import { FacturesModule } from '../factures/factures.module';
import { GedModule } from '../ged/ged.module';

/**
 * Le passeport numérique de l'ouvrage. Il emprunte l'extraction de texte des
 * factures (lire une notice) et le stockage de la GED (en tirer les pièces),
 * et porte le seul point de passage vers l'IA.
 */
@Module({
  imports: [FacturesModule, GedModule],
  controllers: [PasseportController],
  providers: [PasseportService, IaService],
})
export class PasseportModule {}
