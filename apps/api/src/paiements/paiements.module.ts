import { Module } from '@nestjs/common';
import { OrdresPaiementController } from './ordres-paiement.controller';
import { OrdresPaiementService } from './ordres-paiement.service';

@Module({
  controllers: [OrdresPaiementController],
  providers: [OrdresPaiementService],
})
export class PaiementsModule {}
