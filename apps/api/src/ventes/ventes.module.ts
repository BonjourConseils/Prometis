import { Module } from '@nestjs/common';
import { AcquereursController, VentesController } from './ventes.controller';
import { VentesService } from './ventes.service';
import { AppelsDeFondsModule } from '../appels-de-fonds/appels-de-fonds.module';
import { PasserelleModule } from '../passerelle/passerelle.module';
import { GedModule } from '../ged/ged.module';

/**
 * Ventes et appels de fonds dans le même module : l'échéancier appartient à
 * la vente, et c'est lui qui déclenche les appels. Les séparer croiserait
 * les dépendances sans rien clarifier.
 */
@Module({
  // La passerelle est importée pour sa boîte d'envoi : clore un jalon doit
  // pouvoir en informer Kolabimo, sans que Kolabimo puisse empêcher de clore.
  // La GED est importée pour y archiver la QR-facture : une pièce envoyée
  // à un acquéreur doit rester consultable côté promoteur.
  imports: [AppelsDeFondsModule, PasserelleModule, GedModule],
  controllers: [AcquereursController, VentesController],
  providers: [VentesService],
})
export class VentesModule {}
