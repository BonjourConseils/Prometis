import { Module } from '@nestjs/common';
import { IaService } from './ia.service';
import { UsageIaController } from './usage-ia.controller';
import { UsageIaService } from './usage-ia.service';

@Module({
  controllers: [UsageIaController],
  providers: [IaService, UsageIaService],
  exports: [IaService],
})
export class IaModule {}
