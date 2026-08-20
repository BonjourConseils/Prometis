import { Module } from '@nestjs/common';
import { SocieteController } from './societe.controller';
import { TauxAcquisitionController } from './taux-acquisition.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [SocieteController, TauxAcquisitionController],
})
export class SocieteModule {}
