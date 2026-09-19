import { Module } from '@nestjs/common';
import { AccesController, InvitationsPubliquesController } from './acces.controller';
import { AccesService } from './acces.service';
import { InvitationsService } from './invitations.service';

@Module({
  controllers: [AccesController, InvitationsPubliquesController],
  providers: [AccesService, InvitationsService],
})
export class AccesModule {}
