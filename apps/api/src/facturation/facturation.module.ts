import { Module } from '@nestjs/common';
import { ModulesModule } from '../modules/modules.module';
import { ExploitantGuard } from '../modules/exploitant.guard';
import { FacturationService } from './facturation.service';
import {
  FacturationController,
  PasseQuotidienneController,
  TarifsController,
  WebhookStripeController,
} from './facturation.controller';

/** La facturation Stripe par module. Change les modules par `ModulesService`, et lui seul. */
@Module({
  imports: [ModulesModule],
  controllers: [
    FacturationController,
    WebhookStripeController,
    PasseQuotidienneController,
    TarifsController,
  ],
  providers: [FacturationService, ExploitantGuard],
})
export class FacturationModule {}
