import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ActeurType } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';

export interface DonneesActeur {
  type: ActeurType;
  typeLibre?: string | null;
  societeNom?: string | null;
  nom?: string | null;
  prenom?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  localite?: string | null;
  email?: string | null;
  telephone?: string | null;
  ide?: string | null;
}

export interface DonneesRattachement {
  role: ActeurType;
  roleLibre?: string | null;
  estMandataireGeneral?: boolean;
  suitLeProjet?: boolean;
  montantMandat?: Prisma.Decimal | null;
  ordre?: number;
}

@Injectable()
export class ActeursService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Annuaire des acteurs de la société : notaires, géomètres, ingénieurs,
   * architectes, entreprises générales, courtiers.
   *
   * Il est au niveau du **tenant**, pas de l'opération : le même notaire sert
   * plusieurs promotions, et c'est tout l'intérêt de l'annuaire.
   */
  async lister(type?: ActeurType) {
    return this.db.run((tx) =>
      tx.acteur.findMany({
        where: type ? { type } : {},
        include: {
          _count: { select: { operationActeurs: true } },
        },
        orderBy: [{ type: 'asc' }, { societeNom: 'asc' }],
      }),
    );
  }

  async creer(donnees: DonneesActeur) {
    const societeId = RequestContext.requireSocieteId();
    return this.db.run(async (tx) => {
      const acteur = await tx.acteur.create({ data: { societeId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'acteur.cree',
        entite: 'Acteur',
        entiteId: acteur.id,
        donnees: { type: acteur.type, societeNom: acteur.societeNom },
      });
      return acteur;
    });
  }

  async modifier(acteurId: number, donnees: Partial<DonneesActeur>) {
    return this.db.run(async (tx) => {
      const existe = await tx.acteur.findUnique({ where: { id: acteurId }, select: { id: true } });
      if (!existe) throw new NotFoundException(`Acteur ${acteurId} introuvable.`);

      const acteur = await tx.acteur.update({ where: { id: acteurId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'acteur.modifie',
        entite: 'Acteur',
        entiteId: acteurId,
        donnees: { champs: Object.keys(donnees) },
      });
      return acteur;
    });
  }

  /** Acteurs rattachés à une opération, avec leur rôle sur le projet. */
  async listerPourOperation(operationId: number) {
    return this.db.run((tx) =>
      tx.operationActeur.findMany({
        where: { operationId },
        select: {
          id: true,
          role: true,
          roleLibre: true,
          estMandataireGeneral: true,
          suitLeProjet: true,
          montantMandat: true,
          ordre: true,
          acteur: {
            select: {
              id: true,
              type: true,
              societeNom: true,
              nom: true,
              prenom: true,
              email: true,
              telephone: true,
              localite: true,
            },
          },
        },
        orderBy: { ordre: 'asc' },
      }),
    );
  }

  /**
   * Rattache un acteur à une opération.
   *
   * `estMandataireGeneral` désigne celui qui « se charge de tout » — l'EG ou
   * l'architecte mandataire. Il ne peut y en avoir qu'un : deux mandataires
   * généraux, c'est une opération dont personne ne sait qui la pilote.
   */
  async rattacher(operationId: number, acteurId: number, donnees: DonneesRattachement) {
    return this.db.run(async (tx) => {
      const acteur = await tx.acteur.findUnique({
        where: { id: acteurId },
        select: { id: true, societeNom: true, type: true },
      });
      if (!acteur) throw new NotFoundException(`Acteur ${acteurId} introuvable.`);

      if (donnees.estMandataireGeneral) {
        const autre = await tx.operationActeur.findFirst({
          where: { operationId, estMandataireGeneral: true, NOT: { acteurId } },
          select: { acteur: { select: { societeNom: true } } },
        });
        if (autre) {
          throw new BadRequestException(
            `« ${autre.acteur.societeNom ?? 'Un acteur'} » est déjà mandataire général de cette opération. ` +
              'Retirez-lui le mandat avant de le confier à un autre.',
          );
        }
      }

      const rattachement = await tx.operationActeur.upsert({
        where: {
          operationId_acteurId_role: { operationId, acteurId, role: donnees.role },
        },
        create: { operationId, acteurId, ...donnees },
        update: donnees,
      });

      await this.audit.enregistrer(tx, {
        action: 'operation_acteur.rattache',
        entite: 'OperationActeur',
        entiteId: rattachement.id,
        donnees: {
          operationId,
          acteur: acteur.societeNom,
          role: donnees.role,
          mandataireGeneral: donnees.estMandataireGeneral ?? false,
        },
      });
      return rattachement;
    });
  }

  async detacher(operationId: number, rattachementId: number) {
    return this.db.run(async (tx) => {
      const { count } = await tx.operationActeur.deleteMany({
        where: { id: rattachementId, operationId },
      });
      if (count === 0) {
        throw new NotFoundException(
          `Rattachement ${rattachementId} introuvable sur cette opération.`,
        );
      }
      await this.audit.enregistrer(tx, {
        action: 'operation_acteur.detache',
        entite: 'OperationActeur',
        entiteId: rattachementId,
        donnees: { operationId },
      });
      return { detache: true };
    });
  }
}
