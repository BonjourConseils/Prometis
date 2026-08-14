import { Module } from '@nestjs/common';
import { FacturesController } from './factures.controller';
import { FacturesService } from './factures.service';

@Module({
  controllers: [FacturesController],
  providers: [FacturesService],
})
export class FacturesModule {}
