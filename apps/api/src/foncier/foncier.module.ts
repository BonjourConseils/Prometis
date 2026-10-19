import { Module } from '@nestjs/common';
import { FoncierController } from './foncier.controller';
import { FoncierService } from './foncier.service';
import { RdppfService } from './rdppf.service';
import { OcrService } from '../factures/ocr.service';
import { IaService } from '../ia/ia.service';
import { StockageService } from '../stockage/stockage.service';

@Module({
  controllers: [FoncierController],
  providers: [FoncierService, RdppfService, OcrService, IaService, StockageService],
})
export class FoncierModule {}
