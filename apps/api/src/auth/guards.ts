import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AppModule, UtilisateurRole } from '@prisma/client';
import { RequestContext } from '../context/request-context';
import { AccessService } from './access.service';
import {
  IS_PUBLIC,
  NO_WORKSPACE,
  OPERATION_ACCESS,
  REQUIRED_APP_MODULE,
  ROLES,
  type OperationAccessRequirement,
} from './decorators';

/**
 * Authentification, et présence d'un espace de travail.
 *
 * L'espace de travail est requis **par défaut** : une route qui oublie de se
 * déclarer devient plus stricte, jamais plus permissive. C'est le sens dans
 * lequel on veut se tromper.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const cibles = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, cibles)) return true;

    if (!RequestContext.compte()) {
      throw new UnauthorizedException('Authentification requise.');
    }

    const sansWorkspace = this.reflector.getAllAndOverride<boolean>(NO_WORKSPACE, cibles);
    if (!sansWorkspace && !RequestContext.workspace()) {
      throw new ForbiddenException(
        "Aucun espace de travail choisi. Appeler POST /auth/workspace avec l'identifiant de société.",
      );
    }

    return true;
  }
}

/** Rôle du compte dans la société (`Membership.role`). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requis = this.reflector.getAllAndOverride<UtilisateurRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requis?.length) return true;

    const workspace = RequestContext.workspace();
    if (!workspace || !requis.includes(workspace.role)) {
      throw new ForbiddenException(
        `Action réservée aux rôles : ${requis.join(', ')}. Le vôtre : ${workspace?.role ?? 'aucun'}.`,
      );
    }
    return true;
  }
}

/** Module activé sur la société (`Societe.modulesActifs`). */
@Injectable()
export class AppModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<AppModule>(REQUIRED_APP_MODULE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;

    await this.access.assertModuleActif(module);
    return true;
  }
}

/** Droit sur l'opération ciblée par la route (`OperationAccess`). */
@Injectable()
export class OperationAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<OperationAccessRequirement>(
      OPERATION_ACCESS,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const param = requirement.param ?? 'operationId';
    const request = context.switchToHttp().getRequest<Request>();
    const brut = (request.params as Record<string, string | undefined>)[param];
    const operationId = Number(brut);

    if (!Number.isInteger(operationId) || operationId <= 0) {
      throw new ForbiddenException(`Paramètre de route « ${param} » manquant ou invalide.`);
    }

    await this.access.assertAccesOperation(operationId, requirement.level, requirement.module);
    return true;
  }
}
