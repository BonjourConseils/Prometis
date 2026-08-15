import { Module } from '@nestjs/common';
import { CourtageController, TresorerieController } from './courtage.controller';
import { CourtageService } from './courtage.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';

/**
 * Courtage et trésorerie dans le même module.
 *
 * Les deux relèvent de la surcouche promoteur et se lisent ensemble : une
 * commission due est une sortie de caisse à venir. Les séparer créerait deux
 * modules d'un contrôleur chacun.
 */
@Module({
  controllers: [CourtageController, TresorerieController],
  providers: [CourtageService, TresorerieService],
})
export class CourtageModule {}
