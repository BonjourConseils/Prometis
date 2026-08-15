import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SeancePointStatut, SeanceStatut, SeanceType } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { GedService } from '../ged/ged.service';
import { enRetard, redigerPv, type ParticipantPv, type PointPv } from './pv';

@Injectable()
export class SeancesService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly ged: GedService,
  ) {}

  // ===================================================================
  //  Séances
  // ===================================================================

  async lister(operationId: number, filtres: { statut?: SeanceStatut; type?: SeanceType } = {}) {
    return this.db.run((tx) =>
      tx.seance.findMany({
        where: {
          operationId,
          ...(filtres.statut ? { statut: filtres.statut } : {}),
          ...(filtres.type ? { type: filtres.type } : {}),
        },
        include: {
          participants: true,
          _count: { select: { points: true, documents: true } },
        },
        // Les séances sans date (planifiées sans jour fixé) restent en tête :
        // ce sont celles qu'il faut caler.
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  async detail(operationId: number, seanceId: number) {
    const seance = await this.db.run((tx) =>
      tx.seance.findFirst({
        where: { id: seanceId, operationId },
        include: {
          participants: { orderBy: { id: 'asc' } },
          points: { orderBy: { ordre: 'asc' } },
          documents: {
            select: { id: true, titre: true, categorie: true, fileName: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    );
    if (!seance) throw new NotFoundException(`Séance ${seanceId} introuvable.`);

    const maintenant = new Date();
    return {
      ...seance,
      points: seance.points.map((p) => ({
        ...p,
        enRetard: enRetard({ ...p, statut: p.statut }, maintenant),
      })),
    };
  }

  async creer(
    operationId: number,
    donnees: {
      titre: string;
      type?: SeanceType;
      date?: Date | null;
      lieu?: string | null;
      ordreDuJour?: string | null;
      numero?: string | null;
    },
  ) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;

    return this.db.run(async (tx) => {
      const seance = await tx.seance.create({
        data: {
          societeId,
          operationId,
          titre: donnees.titre,
          type: donnees.type ?? 'CHANTIER',
          date: donnees.date ?? null,
          lieu: donnees.lieu ?? null,
          ordreDuJour: donnees.ordreDuJour ?? null,
          numero: donnees.numero ?? null,
          createdById: membershipId,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'seance.creee',
        entite: 'Seance',
        entiteId: seance.id,
        donnees: { operationId, titre: seance.titre, type: seance.type },
      });
      return seance;
    });
  }

  async modifier(
    operationId: number,
    seanceId: number,
    donnees: {
      titre?: string;
      type?: SeanceType;
      statut?: SeanceStatut;
      date?: Date | null;
      lieu?: string | null;
      ordreDuJour?: string | null;
      notes?: string | null;
      numero?: string | null;
    },
  ) {
    return this.db.run(async (tx) => {
      const existante = await tx.seance.findFirst({
        where: { id: seanceId, operationId },
        select: { id: true, statut: true, date: true },
      });
      if (!existante) throw new NotFoundException(`Séance ${seanceId} introuvable.`);

      // Une séance ne se tient pas sans date : sans elle, le PV n'aurait pas
      // de repère, et les échéances qui en découlent non plus.
      if (donnees.statut === 'TENUE') {
        const date = donnees.date ?? existante.date;
        if (!date) {
          throw new BadRequestException(
            'Une séance ne peut pas être marquée tenue sans date : le procès-verbal en dépend.',
          );
        }
      }

      return tx.seance.update({ where: { id: seanceId }, data: donnees });
    });
  }

  // ===================================================================
  //  Participants et points
  // ===================================================================

  async ajouterParticipant(
    operationId: number,
    seanceId: number,
    donnees: {
      membershipId?: number | null;
      acteurId?: number | null;
      nom?: string | null;
      organisation?: string | null;
      email?: string | null;
      present?: boolean;
    },
  ) {
    return this.db.run(async (tx) => {
      await this.exigerSeance(tx, operationId, seanceId);

      if (!donnees.membershipId && !donnees.acteurId && !donnees.nom) {
        throw new BadRequestException(
          'Un participant doit être un membre, un acteur de l’annuaire, ou porter un nom.',
        );
      }
      if (donnees.acteurId) {
        const acteur = await tx.acteur.findUnique({
          where: { id: donnees.acteurId },
          select: { id: true },
        });
        if (!acteur) throw new NotFoundException(`Acteur ${donnees.acteurId} introuvable.`);
      }

      return tx.seanceParticipant.create({
        data: { seanceId, ...donnees, present: donnees.present ?? true },
      });
    });
  }

  async retirerParticipant(operationId: number, seanceId: number, participantId: number) {
    return this.db.run(async (tx) => {
      await this.exigerSeance(tx, operationId, seanceId);
      const supprime = await tx.seanceParticipant.deleteMany({
        where: { id: participantId, seanceId },
      });
      if (supprime.count === 0) {
        throw new NotFoundException(`Participant ${participantId} introuvable dans cette séance.`);
      }
      return { supprime: true };
    });
  }

  async ajouterPoint(
    operationId: number,
    seanceId: number,
    donnees: {
      titre: string;
      ordre?: number;
      contenu?: string | null;
      responsable?: string | null;
      echeance?: Date | null;
      cfcNodeId?: number | null;
    },
  ) {
    return this.db.run(async (tx) => {
      await this.exigerSeance(tx, operationId, seanceId);

      if (donnees.cfcNodeId) {
        const noeud = await tx.cfcNode.findFirst({
          where: { id: donnees.cfcNodeId, operationId },
          select: { id: true },
        });
        if (!noeud) {
          throw new NotFoundException(
            `Poste CFC ${donnees.cfcNodeId} introuvable dans l'opération.`,
          );
        }
      }

      // Sans numéro fourni, on prend la suite : un ordre du jour se numérote,
      // et deux points au même rang rendraient le PV incompréhensible.
      const ordre =
        donnees.ordre ??
        ((await tx.seancePoint.aggregate({ where: { seanceId }, _max: { ordre: true } }))._max
          .ordre ?? 0) + 1;

      return tx.seancePoint.create({ data: { seanceId, ...donnees, ordre } });
    });
  }

  async modifierPoint(
    operationId: number,
    seanceId: number,
    pointId: number,
    donnees: {
      titre?: string;
      ordre?: number;
      contenu?: string | null;
      responsable?: string | null;
      echeance?: Date | null;
      statut?: SeancePointStatut;
    },
  ) {
    return this.db.run(async (tx) => {
      await this.exigerSeance(tx, operationId, seanceId);
      const point = await tx.seancePoint.findFirst({
        where: { id: pointId, seanceId },
        select: { id: true },
      });
      if (!point) throw new NotFoundException(`Point ${pointId} introuvable dans cette séance.`);
      return tx.seancePoint.update({ where: { id: pointId }, data: donnees });
    });
  }

  // ===================================================================
  //  Procès-verbal
  // ===================================================================

  /**
   * Rédige le PV et le dépose en GED.
   *
   * Le PV passe par `GedService` comme n'importe quelle pièce : versionné,
   * rattaché à la séance, soumis aux mêmes droits. Un second chemin d'écriture
   * de documents finirait par diverger du premier — sur le partage externe,
   * typiquement.
   *
   * Rejouer la génération dépose une **nouvelle version**, jamais un second
   * document : un PV corrigé remplace le précédent, mais le précédent reste
   * consultable, parce qu'il a peut-être déjà été diffusé.
   */
  async genererPv(operationId: number, seanceId: number) {
    const societeId = RequestContext.requireSocieteId();

    const contexte = await this.db.run(async (tx) => {
      const seance = await tx.seance.findFirst({
        where: { id: seanceId, operationId },
        include: {
          participants: true,
          points: { orderBy: { ordre: 'asc' } },
          operation: { select: { nom: true } },
          documents: {
            where: { categorie: 'PV_SEANCE' },
            select: { id: true, parentDocumentId: true },
            orderBy: { version: 'desc' },
          },
        },
      });
      if (!seance) throw new NotFoundException(`Séance ${seanceId} introuvable.`);

      const societe = await tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: { raisonSociale: true },
      });
      return { seance, societe };
    });

    const { seance, societe } = contexte;

    const participants: ParticipantPv[] = seance.participants.map((p) => ({
      nom: p.nom ?? p.email ?? 'Participant sans nom',
      organisation: p.organisation,
      present: p.present,
    }));
    const points: PointPv[] = seance.points.map((p) => ({
      ordre: p.ordre,
      titre: p.titre,
      contenu: p.contenu,
      responsable: p.responsable,
      echeance: p.echeance,
      statut: p.statut,
    }));

    const texte = redigerPv(
      {
        titre: seance.titre,
        numero: seance.numero,
        type: seance.type,
        date: seance.date,
        lieu: seance.lieu,
        ordreDuJour: seance.ordreDuJour,
        notes: seance.notes,
        operationNom: seance.operation.nom,
        societeNom: societe.raisonSociale,
      },
      participants,
      points,
    );

    const fichier = {
      nomOriginal: `pv-${seance.numero ?? `seance-${seance.id}`}.md`,
      mimeType: 'text/markdown',
      contenu: Buffer.from(texte, 'utf8'),
    };

    const existant = seance.documents[0];
    const document = existant
      ? await this.ged.deposerVersion(operationId, existant.id, fichier)
      : await this.ged.deposer(operationId, fichier, {
          titre: `PV — ${seance.numero ? `${seance.numero} ` : ''}${seance.titre}`,
          categorie: 'PV_SEANCE',
          seanceId,
        });

    await this.db.run((tx) =>
      this.audit.enregistrer(tx, {
        action: 'seance.pv_genere',
        entite: 'Seance',
        entiteId: seanceId,
        donnees: { operationId, documentId: document.id, version: document.version },
      }),
    );

    return { document, texte };
  }

  // ===================================================================
  //  Suivi transverse
  // ===================================================================

  /**
   * Points d'action encore ouverts sur toute l'opération.
   *
   * C'est la vue qui fait la valeur du module : un PV qu'on relit séance après
   * séance ne dit pas ce qui traîne depuis trois réunions. Ici, si.
   */
  async actionsOuvertes(operationId: number) {
    const maintenant = new Date();
    const points = await this.db.run((tx) =>
      tx.seancePoint.findMany({
        where: { seance: { operationId }, statut: { in: ['OUVERT', 'EN_COURS'] } },
        include: {
          seance: { select: { id: true, titre: true, numero: true, date: true, type: true } },
        },
        orderBy: [{ echeance: 'asc' }, { id: 'asc' }],
      }),
    );

    const enrichis = points.map((p) => ({
      ...p,
      enRetard: enRetard(
        { ordre: p.ordre, titre: p.titre, echeance: p.echeance, statut: p.statut },
        maintenant,
      ),
    }));

    return {
      total: enrichis.length,
      enRetard: enrichis.filter((p) => p.enRetard).length,
      sansEcheance: enrichis.filter((p) => !p.echeance).length,
      points: enrichis,
    };
  }

  /** Toute écriture sur un enfant remonte à l'opération de la route. */
  private async exigerSeance(tx: TenantDb, operationId: number, seanceId: number): Promise<void> {
    const seance = await tx.seance.findFirst({
      where: { id: seanceId, operationId },
      select: { id: true },
    });
    if (!seance) throw new NotFoundException(`Séance ${seanceId} introuvable.`);
  }
}
