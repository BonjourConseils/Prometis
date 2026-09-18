import { Module } from '@nestjs/common';
import { FacturesController } from './factures.controller';
import { FacturesService } from './factures.service';
import { OcrService } from './ocr.service';

@Module({
  controllers: [FacturesController],
  providers: [FacturesService, OcrService],
  // L'extraction de texte sert aussi au passeport, qui lit les notices : un
  // seul binaire OCR, appelé d'un seul endroit.
  exports: [OcrService],
})
export class FacturesModule {}
