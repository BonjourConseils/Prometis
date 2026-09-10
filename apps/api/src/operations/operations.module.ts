import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { BilanService } from './bilan.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, BilanService],
  // La passerelle crée l'opération d'une promotion Kolabimo par ce service,
  // pour qu'elle naisse comme les autres : créateur en MANAGE, audit compris.
  exports: [OperationsService],
})
export class OperationsModule {}
