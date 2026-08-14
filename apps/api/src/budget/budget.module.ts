import { Module } from '@nestjs/common';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { CfcService } from './cfc.service';

@Module({
  controllers: [BudgetController],
  providers: [BudgetService, CfcService],
})
export class BudgetModule {}
