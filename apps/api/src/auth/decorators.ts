import { SetMetadata } from '@nestjs/common';
import type {
  AccessModule,
  AppModule,
  OperationAccessLevel,
  UtilisateurRole,
} from '@prisma/client';

export const IS_PUBLIC = 'auth:public';
export const NO_WORKSPACE = 'auth:no-workspace';
export const ROLES = 'auth:roles';
export const REQUIRED_APP_MODULE = 'auth:app-module';
export const OPERATION_ACCESS = 'auth:operation-access';

/** Route ouverte : ni compte ni espace de travail. À n'employer que sur /auth/login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route accessible avec un jeton d'identité seul, sans espace de travail choisi.
 * Réservée au sélecteur d'espace : partout ailleurs, le tenant est requis.
 */
export const NoWorkspace = () => SetMetadata(NO_WORKSPACE, true);

/** Rôles autorisés au niveau du tenant (`Membership.role`). */
export const Roles = (...roles: UtilisateurRole[]) => SetMetadata(ROLES, roles);

/**
 * Module qui doit être actif sur la société (`Societe.modulesActifs`).
 * C'est ce qui empêche une entreprise générale d'atteindre les appels de fonds,
 * même en connaissant l'URL.
 */
export const RequireModule = (module: AppModule) => SetMetadata(REQUIRED_APP_MODULE, module);

export interface OperationAccessRequirement {
  level: OperationAccessLevel;
  /** Restriction fine d'un accès externe (`OperationAccess.modules`). */
  module?: AccessModule;
  /** Nom du paramètre de route portant l'id d'opération. Défaut : `operationId`. */
  param?: string;
}

/** Droit requis SUR une opération donnée (`OperationAccess`). */
export const RequireOperationAccess = (requirement: OperationAccessRequirement) =>
  SetMetadata(OPERATION_ACCESS, requirement);
