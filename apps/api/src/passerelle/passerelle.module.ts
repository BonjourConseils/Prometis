import { Module, forwardRef } from '@nestjs/common';
import {
  OperationPasserelleController,
  PasserelleController,
  WebhooksKolabimoController,
} from './passerelle.controller';
import { PasserelleService } from './passerelle.service';
import { KolabimoClient } from './kolabimo.client';
import { AppelsDeFondsModule } from '../appels-de-fonds/appels-de-fonds.module';

/**
 * La passerelle Kolabimo, dans les deux sens.
 *
 * La dépendance allait autrefois dans un seul sens : le moteur d'appels de
 * fonds déposait ses événements dans la boîte d'envoi, la passerelle ne
 * connaissait pas le moteur. Depuis que **Kolabimo est maître de la fin de
 * jalon** (02.09.2026), un webhook entrant déclenche les appels : le cycle est
 * réel, et les `forwardRef` le disent plutôt que de le contourner.
 */
@Module({
  imports: [forwardRef(() => AppelsDeFondsModule)],
  controllers: [WebhooksKolabimoController, PasserelleController, OperationPasserelleController],
  providers: [PasserelleService, KolabimoClient],
  exports: [PasserelleService],
})
export class PasserelleModule {}
