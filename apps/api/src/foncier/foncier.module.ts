import { Module } from '@nestjs/common';
import { FoncierController } from './foncier.controller';
import { FoncierService } from './foncier.service';

@Module({
  controllers: [FoncierController],
  providers: [FoncierService],
})
export class FoncierModule {}
