import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RequireOperationAccess } from '../auth/decorators';
import { OperationsService, type OperationListItem } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  async findAll(): Promise<OperationListItem[]> {
    return this.operations.findAll();
  }

  @RequireOperationAccess({ level: 'READ_ONLY' })
  @Get(':operationId')
  async findOne(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.operations.findOne(operationId);
  }

  /**
   * L'équipe de l'opération — notaire, architecte, géomètre, entreprise générale.
   *
   * Tranche fine empruntée au Lot 2 (annuaire des acteurs), volontairement en
   * lecture seule. Elle est ici parce qu'elle porte une restriction par module :
   * sans elle, le « accès scopé par module » du Lot 1 resterait une intention
   * non vérifiable de bout en bout.
   */
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'ACTEURS' })
  @Get(':operationId/acteurs')
  async acteurs(@Param('operationId', ParseIntPipe) operationId: number) {
    return this.operations.acteurs(operationId);
  }
}
