import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessModule, AppModule, OperationAccessLevel } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';

/** READ_ONLY < OPERATE < MANAGE. */
const RANG: Record<OperationAccessLevel, number> = {
  READ_ONLY: 1,
  OPERATE: 2,
  MANAGE: 3,
};

export interface AccesOperation {
  level: OperationAccessLevel;
  /** Vide = tous les modules permis par le niveau. */
  modules: AccessModule[];
}

/**
 * Autorisations, en deux étages :
 *
 *   1. `Membership.role` — ce que le compte peut faire DANS la société.
 *   2. `OperationAccess` — ce qu'il peut faire SUR une opération précise,
 *      éventuellement restreint à certains `AccessModule`.
 *
 * Les deux, jamais l'un ou l'autre. Un chef de projet n'accède pas à une
 * opération sur laquelle personne ne lui a donné de droit ; une entreprise
 * générale à qui on a ouvert les soumissions ne voit pas les ventes.
 */
@Injectable()
export class AccessService {
  constructor(private readonly tenantDb: TenantPrismaService) {}

  /** OWNER et ADMIN ont la main sur toutes les opérations de leur société. */
  estAdministrateur(): boolean {
    const role = RequestContext.requireWorkspace().role;
    return role === 'OWNER' || role === 'ADMIN';
  }

  async modulesActifs(): Promise<AppModule[]> {
    const societeId = RequestContext.requireSocieteId();
    const societe = await this.tenantDb.run((tx) =>
      tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: { modulesActifs: true },
      }),
    );
    return societe.modulesActifs;
  }

  async assertModuleActif(module: AppModule): Promise<void> {
    const modules = await this.modulesActifs();
    if (!modules.includes(module)) {
      throw new ForbiddenException(`Le module ${module} n'est pas activé pour cette société.`);
    }
  }

  /**
   * Droit du membership courant sur une opération.
   * `null` = aucun droit. Les administrateurs obtiennent MANAGE d'office.
   */
  async accesOperation(operationId: number): Promise<AccesOperation | null> {
    if (this.estAdministrateur()) {
      // On vérifie quand même que l'opération existe DANS le tenant : la RLS
      // s'en charge, findUnique renverra null pour une opération d'ailleurs.
      const operation = await this.tenantDb.run((tx) =>
        tx.operation.findUnique({ where: { id: operationId }, select: { id: true } }),
      );
      return operation ? { level: 'MANAGE', modules: [] } : null;
    }

    const membershipId = RequestContext.requireWorkspace().membershipId;
    const acces = await this.tenantDb.run((tx) =>
      tx.operationAccess.findUnique({
        where: { operationId_membershipId: { operationId, membershipId } },
        select: { accessLevel: true, modules: true },
      }),
    );

    return acces ? { level: acces.accessLevel, modules: acces.modules } : null;
  }

  async assertAccesOperation(
    operationId: number,
    niveauRequis: OperationAccessLevel,
    module?: AccessModule,
  ): Promise<AccesOperation> {
    const acces = await this.accesOperation(operationId);

    if (!acces) {
      // Même réponse qu'une opération inexistante : on ne révèle pas
      // l'existence d'une opération à qui n'y a pas droit.
      throw new NotFoundException(`Opération ${operationId} introuvable.`);
    }

    if (RANG[acces.level] < RANG[niveauRequis]) {
      throw new ForbiddenException(
        `Niveau ${niveauRequis} requis sur cette opération, vous avez ${acces.level}.`,
      );
    }

    // `modules` vide = pas de restriction fine.
    if (module && acces.modules.length > 0 && !acces.modules.includes(module)) {
      throw new ForbiddenException(`Votre accès à cette opération ne couvre pas ${module}.`);
    }

    return acces;
  }

  /**
   * Opérations visibles par le membership courant.
   * `'toutes'` pour un administrateur — inutile de matérialiser la liste.
   */
  async operationsAutorisees(): Promise<number[] | 'toutes'> {
    if (this.estAdministrateur()) return 'toutes';

    const membershipId = RequestContext.requireWorkspace().membershipId;
    const acces = await this.tenantDb.run((tx) =>
      tx.operationAccess.findMany({ where: { membershipId }, select: { operationId: true } }),
    );
    return acces.map((a) => a.operationId);
  }
}
