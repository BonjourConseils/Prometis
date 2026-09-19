import { Module } from '@nestjs/common';
import { FacturesController } from './factures.controller';
import { FacturesService } from './factures.service';
import { OcrService } from './ocr.service';
import { LectureFacturesService } from './lecture-factures.service';
import { IaService } from '../ia/ia.service';
import { StockageService } from '../stockage/stockage.service';

@Module({
  controllers: [FacturesController],
  providers: [FacturesService, OcrService, LectureFacturesService, IaService, StockageService],
  // L'extraction de texte sert aussi au passeport, qui lit les notices : un
  // seul binaire OCR, appelé d'un seul endroit. La réception des factures
  // sert aussi à la boîte e-mail de chaque promotion.
  exports: [OcrService, LectureFacturesService],
})
export class FacturesModule {}
