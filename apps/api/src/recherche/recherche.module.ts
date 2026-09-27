import { Module } from '@nestjs/common';
import { RechercheController } from './recherche.controller';
import { RechercheWebService } from './recherche-web.service';
import { IaService } from '../ia/ia.service';

@Module({
  controllers: [RechercheController],
  providers: [RechercheWebService, IaService],
})
export class RechercheModule {}
