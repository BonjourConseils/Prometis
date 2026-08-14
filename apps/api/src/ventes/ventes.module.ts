import { Module } from '@nestjs/common';
import { AcquereursController, VentesController } from './ventes.controller';
import { VentesService } from './ventes.service';
import { AppelsDeFondsService } from '../appels-de-fonds/appels-de-fonds.service';
import { PasserelleModule } from '../passerelle/passerelle.module';

/**
 * Ventes et appels de fonds dans le même module : l'échéancier appartient à
 * la vente, et c'est lui qui déclenche les appels. Les séparer croiserait
 * les dépendances sans rien clarifier.
 */
@Module({
  // La passerelle est importée pour sa boîte d'envoi : clore un jalon doit
  // pouvoir en informer Kolabimo, sans que Kolabimo puisse empêcher de clore.
  imports: [PasserelleModule],
  controllers: [AcquereursController, VentesController],
  providers: [VentesService, AppelsDeFondsService],
})
export class VentesModule {}
