import { Module } from '@nestjs/common';
import { SeancesController } from './seances.controller';
import { SeancesService } from './seances.service';
import { GedModule } from '../ged/ged.module';

/** Les séances déposent leur PV en GED : un PV est un document comme un autre. */
@Module({
  imports: [GedModule],
  controllers: [SeancesController],
  providers: [SeancesService],
})
export class SeancesModule {}
