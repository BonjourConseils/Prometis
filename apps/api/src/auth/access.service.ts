import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessModule, AppModule, OperationAccessLevel } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { modulesTechniques } from '../modules/catalogue';
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
    return (await this.modulesOuverts()).actifs;
  }

  /**
   * Les modules ouverts, **calculés à la lecture** depuis les souscriptions.
   *
   * Un essai qui expire ne doit pas attendre une tâche planifiée pour se
   * fermer : une passe quotidienne peut mourir sans bruit, et l'essai
   * resterait ouvert indéfiniment. Le calcul est donc refait à chaque
   * contrôle — une requête, sur une poignée de lignes — et la valeur stockée,
   * qui sert à l'affichage, est corrigée au passage si elle a dérivé.
   */
  async modulesOuverts(): Promise<{ actifs: AppModule[]; lecture: AppModule[] }> {
    const societeId = RequestContext.requireSocieteId();
    return this.tenantDb.run(async (tx) => {
      const societe = await tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: {
          profil: true,
          modulesActifs: true,
          modulesLecture: true,
          souscriptions: { select: { module: true, statut: true, finEssai: true } },
        },
      });
      const ouverts = modulesTechniques(societe.souscriptions, societe.profil);
      const memes = (a: AppModule[], b: AppModule[]) =>
        a.length === b.length && [...a].sort().every((m, i) => m === [...b].sort()[i]);
      if (
        !memes(ouverts.actifs, societe.modulesActifs) ||
        !memes(ouverts.lecture, societe.modulesLecture)
      ) {
        await tx.societe.update({
          where: { id: societeId },
          data: { modulesActifs: ouverts.actifs, modulesLecture: ouverts.lecture },
        });
      }
      return ouverts;
    });
  }

  /**
   * Refuse si le module n'est pas ouvert.
   *
   * `lectureSuffit` : une route de lecture accepte aussi un module **résilié**.
   * Résilier ne détruit rien — le client garde l'accès à ce qu'il a saisi,
   * c'est la règle maison des plans payants (« données accessibles »).
   */
  async assertModuleActif(module: AppModule, lectureSuffit = false): Promise<void> {
    const { actifs, lecture } = await this.modulesOuverts();
    if (actifs.includes(module)) return;
    if (lecture.includes(module)) {
      if (lectureSuffit) return;
      throw new ForbiddenException(
        `Le module ${module} est résilié : ses données restent consultables, mais ne se modifient plus.`,
      );
    }
    throw new ForbiddenException(`Le module ${module} n'est pas activé pour cette société.`);
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
