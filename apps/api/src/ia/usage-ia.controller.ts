import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { UsageIaService } from './usage-ia.service';

const jours = z.coerce.number().int().min(1).max(365).catch(30);

/** Ce que l'IA coûte à la société — réservé à l'administration. */
@Roles('OWNER', 'ADMIN')
@Controller('usage-ia')
export class UsageIaController {
  constructor(private readonly usage: UsageIaService) {}

  @Get()
  statistiques(@Query('jours') brut?: string) {
    return this.usage.statistiques(jours.parse(brut));
  }
}
