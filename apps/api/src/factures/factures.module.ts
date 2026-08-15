import { Module } from '@nestjs/common';
import { FacturesController } from './factures.controller';
import { FacturesService } from './factures.service';
import { OcrService } from './ocr.service';

@Module({
  controllers: [FacturesController],
  providers: [FacturesService, OcrService],
})
export class FacturesModule {}
