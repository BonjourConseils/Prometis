import { Module } from '@nestjs/common';
import {
  OperationPasserelleController,
  PasserelleController,
  WebhooksKolabimoController,
} from './passerelle.controller';
import { PasserelleService } from './passerelle.service';
import { KolabimoClient } from './kolabimo.client';

/**
 * La passerelle Kolabimo, dans les deux sens.
 *
 * `PasserelleService` est exporté parce que le moteur d'appels de fonds y
 * dépose ses événements sortants. La dépendance ne va que dans ce sens : la
 * passerelle ne connaît pas le moteur, elle ne connaît que la boîte d'envoi.
 */
@Module({
  controllers: [WebhooksKolabimoController, PasserelleController, OperationPasserelleController],
  providers: [PasserelleService, KolabimoClient],
  exports: [PasserelleService],
})
export class PasserelleModule {}
