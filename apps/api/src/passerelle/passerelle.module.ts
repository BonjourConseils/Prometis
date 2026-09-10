import { Module, forwardRef } from '@nestjs/common';
import {
  KolabimoController,
  OperationPasserelleController,
  PasserelleController,
  WebhooksKolabimoController,
} from './passerelle.controller';
import { PasserelleService } from './passerelle.service';
import { KolabimoClient } from './kolabimo.client';
import { ConnexionKolabimoService } from './connexion-kolabimo.service';
import { SynchronisationKolabimoService } from './synchronisation-kolabimo.service';
import { AppelsDeFondsModule } from '../appels-de-fonds/appels-de-fonds.module';
import { OperationsModule } from '../operations/operations.module';

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
  // Les opérations, pour qu'une promotion rattachée crée son opération par le
  // même chemin qu'à la main — créateur en MANAGE, audit compris.
  imports: [forwardRef(() => AppelsDeFondsModule), OperationsModule],
  controllers: [
    WebhooksKolabimoController,
    PasserelleController,
    OperationPasserelleController,
    KolabimoController,
  ],
  providers: [
    PasserelleService,
    KolabimoClient,
    ConnexionKolabimoService,
    SynchronisationKolabimoService,
  ],
  exports: [PasserelleService],
})
export class PasserelleModule {}
