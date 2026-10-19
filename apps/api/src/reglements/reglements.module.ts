import { Module } from '@nestjs/common';
import { ReglementsController } from './reglements.controller';
import { ReglementsService } from './reglements.service';
import { StockageService } from '../stockage/stockage.service';
import { OcrService } from '../factures/ocr.service';
import { IaService } from '../ia/ia.service';

/**
 * Les règlements communaux.
 *
 * Module à part, et non une annexe du foncier : la donnée est **partagée**
 * entre toutes les sociétés, alors que tout le foncier est cloisonné par
 * promotion. Les mélanger aurait fini par faire passer un `operationId` là
 * où il n'a pas de sens.
 */
@Module({
  controllers: [ReglementsController],
  providers: [ReglementsService, StockageService, OcrService, IaService],
  exports: [ReglementsService],
})
export class ReglementsModule {}
