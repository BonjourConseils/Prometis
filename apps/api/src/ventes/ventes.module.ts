import { Module } from '@nestjs/common';
import { AcquereursController, VentesController } from './ventes.controller';
import { VentesService } from './ventes.service';
import { AppelsDeFondsService } from '../appels-de-fonds/appels-de-fonds.service';

/**
 * Ventes et appels de fonds dans le même module : l'échéancier appartient à
 * la vente, et c'est lui qui déclenche les appels. Les séparer croiserait
 * les dépendances sans rien clarifier.
 */
@Module({
  controllers: [AcquereursController, VentesController],
  providers: [VentesService, AppelsDeFondsService],
})
export class VentesModule {}
