import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** La piste d'audit est une pièce de gouvernance : direction et admins seuls. */
  @Roles('OWNER', 'ADMIN')
  @Get()
  async lister(@Query('limite', new DefaultValuePipe(50), ParseIntPipe) limite: number) {
    return this.audit.lister(limite);
  }
}
