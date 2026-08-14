import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccessModule, OperationAccessLevel, UtilisateurRole } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';

@Injectable()
export class AccesService {
  constructor(
    private readonly tenantDb: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /**
   * Droits effectifs du membre courant.
   *
   * C'est ce que le front consomme pour n'afficher que les menus réellement
   * accessibles. Le calcul reste côté serveur : masquer un bouton n'est pas
   * une autorisation, les guards restent la barrière.
   */
  async mesDroits() {
    const workspace = RequestContext.requireWorkspace();
    const modulesActifs = await this.access.modulesActifs();
    const autorisees = await this.access.operationsAutorisees();

    const operations = await this.tenantDb.run(async (tx) => {
      const liste = await tx.operation.findMany({
        where: autorisees === 'toutes' ? {} : { id: { in: autorisees } },
        select: { id: true, nom: true },
        orderBy: { nom: 'asc' },
      });

      if (autorisees === 'toutes') {
        // OWNER et ADMIN : MANAGE partout, sans restriction de module.
        return liste.map((o) => ({ ...o, accessLevel: 'MANAGE' as const, modules: [] }));
      }

      const droits = await tx.operationAccess.findMany({
        where: { membershipId: workspace.membershipId },
        select: { operationId: true, accessLevel: true, modules: true },
      });
      const parOperation = new Map(droits.map((d) => [d.operationId, d]));

      return liste.map((o) => ({
        ...o,
        accessLevel: parOperation.get(o.id)?.accessLevel ?? 'READ_ONLY',
        modules: parOperation.get(o.id)?.modules ?? [],
      }));
    });

    return {
      role: workspace.role,
      estAdministrateur: this.access.estAdministrateur(),
      modulesActifs,
      operations,
    };
  }

  /**
   * Les membres de la société : internes et intervenants externes.
   *
   * Un externe se reconnaît à son `acteurId` — il est rattaché à sa propre
   * société-acteur (EG, notaire, architecte). C'est la distinction qu'affiche
   * l'écran Droits d'accès.
   */
  async listerMembres() {
    return this.tenantDb.run(async (tx) => {
      const memberships = await tx.membership.findMany({
        select: {
          id: true,
          role: true,
          fonction: true,
          isActive: true,
          createdAt: true,
          compte: { select: { id: true, email: true, prenom: true, nom: true, lastLoginAt: true } },
          acteur: { select: { id: true, type: true, societeNom: true } },
          operationAccesses: {
            select: {
              operationId: true,
              accessLevel: true,
              modules: true,
              operation: { select: { nom: true } },
            },
          },
        },
        orderBy: [{ role: 'asc' }, { id: 'asc' }],
      });

      // Un membership rattaché à un acteur est un intervenant externe.
      return memberships.map((m) => ({ ...m, estExterne: m.acteur !== null }));
    });
  }

  /**
   * Modifie le rôle ou l'activation d'un membre.
   *
   * Deux garde-fous : on ne modifie pas son propre membership (ni auto-promotion,
   * ni auto-exclusion), et on ne retire pas le dernier OWNER — une société sans
   * propriétaire actif n'est plus administrable par personne.
   */
  async modifierMembre(
    membershipId: number,
    changements: { role?: UtilisateurRole; isActive?: boolean },
  ) {
    const workspace = RequestContext.requireWorkspace();

    if (membershipId === workspace.membershipId) {
      throw new BadRequestException(
        'Vous ne pouvez pas modifier votre propre accès. Demandez-le à un autre administrateur.',
      );
    }

    return this.tenantDb.run(async (tx) => {
      const membre = await tx.membership.findUnique({
        where: { id: membershipId },
        select: { id: true, role: true, isActive: true, compte: { select: { email: true } } },
      });
      if (!membre) throw new NotFoundException(`Membre ${membershipId} introuvable.`);

      const perdLeRoleOwner =
        membre.role === 'OWNER' &&
        ((changements.role !== undefined && changements.role !== 'OWNER') ||
          changements.isActive === false);

      if (perdLeRoleOwner) {
        const ownersActifs = await tx.membership.count({
          where: { role: 'OWNER', isActive: true },
        });
        if (ownersActifs <= 1) {
          throw new BadRequestException(
            "C'est le dernier propriétaire actif de la société : le retirer rendrait l'espace inadministrable.",
          );
        }
      }

      const apres = await tx.membership.update({
        where: { id: membershipId },
        data: changements,
        select: { id: true, role: true, isActive: true },
      });

      await this.audit.enregistrer(tx, {
        action: 'membership.modifie',
        entite: 'Membership',
        entiteId: membershipId,
        donnees: {
          compte: membre.compte.email,
          avant: { role: membre.role, isActive: membre.isActive },
          apres: { role: apres.role, isActive: apres.isActive },
        },
      });

      return apres;
    });
  }

  /** Droits accordés sur une opération. */
  async listerAccesOperation(operationId: number) {
    return this.tenantDb.run((tx) =>
      tx.operationAccess.findMany({
        where: { operationId },
        select: {
          id: true,
          accessLevel: true,
          modules: true,
          createdAt: true,
          membership: {
            select: {
              id: true,
              role: true,
              compte: { select: { email: true, prenom: true, nom: true } },
              acteur: { select: { societeNom: true, type: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      }),
    );
  }

  /**
   * Accorde ou met à jour un droit sur une opération.
   * `modules` vide = tout ce que le niveau permet.
   */
  async accorderAcces(
    operationId: number,
    membershipId: number,
    accessLevel: OperationAccessLevel,
    modules: AccessModule[],
  ) {
    const workspace = RequestContext.requireWorkspace();

    return this.tenantDb.run(async (tx) => {
      // La RLS garantit déjà que ce membership appartient au tenant courant ;
      // ce contrôle donne une erreur lisible plutôt qu'une violation de clé.
      const membre = await tx.membership.findUnique({
        where: { id: membershipId },
        select: { id: true, compte: { select: { email: true } } },
      });
      if (!membre) throw new NotFoundException(`Membre ${membershipId} introuvable.`);

      const acces = await tx.operationAccess.upsert({
        where: { operationId_membershipId: { operationId, membershipId } },
        create: {
          operationId,
          membershipId,
          accessLevel,
          modules,
          grantedById: workspace.membershipId,
        },
        update: { accessLevel, modules, grantedById: workspace.membershipId },
        select: { id: true, accessLevel: true, modules: true },
      });

      await this.audit.enregistrer(tx, {
        action: 'operation_access.accorde',
        entite: 'OperationAccess',
        entiteId: acces.id,
        donnees: { operationId, membershipId, compte: membre.compte.email, accessLevel, modules },
      });

      return acces;
    });
  }

  async revoquerAcces(operationId: number, membershipId: number) {
    return this.tenantDb.run(async (tx) => {
      const { count } = await tx.operationAccess.deleteMany({
        where: { operationId, membershipId },
      });
      if (count === 0) {
        throw new NotFoundException('Aucun droit à révoquer pour ce membre sur cette opération.');
      }

      await this.audit.enregistrer(tx, {
        action: 'operation_access.revoque',
        entite: 'OperationAccess',
        donnees: { operationId, membershipId },
      });

      return { revoque: true };
    });
  }
}
