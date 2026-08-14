import { Module } from '@nestjs/common';
import { AccesController } from './acces.controller';
import { AccesService } from './acces.service';

@Module({
  controllers: [AccesController],
  providers: [AccesService],
})
export class AccesModule {}
