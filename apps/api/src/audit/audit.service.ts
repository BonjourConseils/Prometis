import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';

export interface EvenementAudit {
  /** Verbe métier : `membership.role_modifie`, `operation_access.accorde`… */
  action: string;
  entite: string;
  entiteId?: number;
  donnees?: Prisma.InputJsonValue;
}

/**
 * Piste d'audit des actions sensibles.
 *
 * `AuditLog.utilisateurId` reçoit le **membershipId**, pas le compteId : la
 * table est scopée à une société, et le membership est l'identité *dans* cette
 * société. Y écrire un compteId ferait entrer un identifiant transverse dans
 * une table tenant.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenantDb: TenantPrismaService) {}

  /**
   * Enregistre dans la transaction du changement.
   *
   * Le `tx` est obligatoire, et c'est le point : si l'écriture métier est
   * annulée, la trace l'est aussi. Une piste d'audit qui atteste d'une action
   * qui n'a pas eu lieu est pire que pas de piste du tout.
   */
  async enregistrer(tx: TenantDb, evenement: EvenementAudit): Promise<void> {
    const workspace = RequestContext.requireWorkspace();
    await tx.auditLog.create({
      data: {
        societeId: workspace.societeId,
        utilisateurId: workspace.membershipId,
        action: evenement.action,
        entite: evenement.entite,
        entiteId: evenement.entiteId ?? null,
        donnees: evenement.donnees ?? undefined,
      },
    });
  }

  /**
   * Trace une action dont l'auteur n'est pas une personne — un webhook entrant,
   * un traitement planifié.
   *
   * `utilisateurId` reste nul, et c'est exact : inventer un membership ferait
   * porter à un collaborateur une décision qu'il n'a pas prise. Le `societeId`,
   * lui, est explicite puisqu'il n'y a pas d'espace de travail à interroger.
   */
  async enregistrerAutomatique(
    tx: TenantDb,
    societeId: number,
    evenement: EvenementAudit,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        societeId,
        utilisateurId: null,
        action: evenement.action,
        entite: evenement.entite,
        entiteId: evenement.entiteId ?? null,
        donnees: evenement.donnees ?? undefined,
      },
    });
  }

  async lister(limite = 50) {
    return this.tenantDb.run((tx) =>
      tx.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(limite, 200),
      }),
    );
  }
}
