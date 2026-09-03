import { Module, forwardRef } from '@nestjs/common';
import { AppelsDeFondsService } from './appels-de-fonds.service';
import { QrFactureService } from './qr-facture.pdf';
import { LettreAcquereurService } from './lettre-acquereur.pdf';
import { PasserelleModule } from '../passerelle/passerelle.module';
import { GedModule } from '../ged/ged.module';

/**
 * Le moteur d'appels de fonds, extrait des ventes pour une raison précise :
 * la passerelle en a besoin.
 *
 * Depuis que **Kolabimo est maître de la fin de jalon** (02.09.2026), un
 * webhook entrant déclenche les appels — et le moteur, lui, continue de
 * déposer ses encaissements dans la boîte d'envoi de la passerelle. Les deux
 * sens existent donc vraiment, d'où les `forwardRef` de part et d'autre.
 * Laisser le service dans `VentesModule` aurait obligé la passerelle à
 * importer les ventes entières pour un seul appel de méthode.
 */
@Module({
  imports: [forwardRef(() => PasserelleModule), GedModule],
  providers: [AppelsDeFondsService, QrFactureService, LettreAcquereurService],
  exports: [AppelsDeFondsService, QrFactureService],
})
export class AppelsDeFondsModule {}
