import { Module } from '@nestjs/common';
import { SocieteController } from './societe.controller';

@Module({ controllers: [SocieteController] })
export class SocieteModule {}
