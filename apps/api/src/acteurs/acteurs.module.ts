import { Module } from '@nestjs/common';
import { ActeursController, OperationActeursController } from './acteurs.controller';
import { ActeursService } from './acteurs.service';

@Module({
  controllers: [ActeursController, OperationActeursController],
  providers: [ActeursService],
})
export class ActeursModule {}
