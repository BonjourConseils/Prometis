import { Module } from '@nestjs/common';
import { DocumentsController } from './ged.controller';
import { GedService } from './ged.service';
import { StockageService } from '../stockage/stockage.service';

/**
 * GED. `GedService` est exporté parce que les séances y déposent leur PV :
 * un procès-verbal est un document comme un autre, et ne doit pas emprunter
 * un second chemin d'écriture.
 */
@Module({
  controllers: [DocumentsController],
  providers: [GedService, StockageService],
  exports: [GedService, StockageService],
})
export class GedModule {}
