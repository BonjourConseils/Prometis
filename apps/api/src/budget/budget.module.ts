import { Module } from '@nestjs/common';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { CfcService } from './cfc.service';
import { EstimatifPdfService } from './estimatif.pdf';

@Module({
  controllers: [BudgetController],
  providers: [BudgetService, CfcService, EstimatifPdfService],
})
export class BudgetModule {}
