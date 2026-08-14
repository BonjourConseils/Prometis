import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { BilanService } from './bilan.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, BilanService],
})
export class OperationsModule {}
