import { Module } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { ExploitantController, ModulesController } from './modules.controller';
import { ExploitantGuard } from './exploitant.guard';

/**
 * Les modules commerciaux : le catalogue, les souscriptions, et l'espace de
 * l'exploitant. `ModulesService` est exporté : la facturation Stripe changera
 * l'état d'un module par lui, et par lui seul.
 */
@Module({
  controllers: [ModulesController, ExploitantController],
  providers: [ModulesService, ExploitantGuard],
  exports: [ModulesService],
})
export class ModulesModule {}
