import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OffreStatut, type SoumissionStatut } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { ConsultationService } from './consultation.service';
import { comparerOffres, type OffreSource } from './comparaison';
import { offreScellee, scorer } from './consultation-regles';

export interface DonneesEntreprise {
  nom: string;
  corpsMetier?: string | null;
  contactNom?: string | null;
  email?: string | null;
  telephone?: string | null;
  ide?: string | null;
}

export interface DonneesSoumission {
  cfcNodeId?: number | null;
  intitule: string;
  corpsMetier?: string | null;
  statut?: SoumissionStatut;
  dateEnvoi?: Date | null;
  dateLimite?: Date | null;
  descriptif?: string | null;
  conditions?: string | null;
  delaiExecution?: string | null;
  offresScellees?: boolean;
}

export interface DonneesOffre {
  entrepriseId: number;
  montant?: Prisma.Decimal | null;
  remisePct?: Prisma.Decimal | null;
  statut?: OffreStatut;
  dateReception?: Date | null;
  note?: string | null;
}

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class SoumissionsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly consultation: ConsultationService,
  ) {}

  // ===================================================================
  //  Répertoire des entreprises
  // ===================================================================

  /**
   * Les entreprises sont au niveau de la **société**, pas de l'opération :
   * on consulte le même plâtrier sur plusieurs promotions, et c'est tout
   * l'intérêt d'un répertoire.
   */
  async listerEntreprises(corpsMetier?: string) {
    return this.db.run((tx) =>
      tx.entreprise.findMany({
        where: corpsMetier ? { corpsMetier: { contains: corpsMetier, mode: 'insensitive' } } : {},
        include: { _count: { select: { offres: true, contrats: true } } },
        orderBy: [{ corpsMetier: 'asc' }, { nom: 'asc' }],
      }),
    );
  }

  async creerEntreprise(donnees: DonneesEntreprise) {
    const societeId = RequestContext.requireSocieteId();
    return this.db.run(async (tx) => {
      const entreprise = await tx.entreprise.create({ data: { societeId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'entreprise.creee',
        entite: 'Entreprise',
        entiteId: entreprise.id,
        donnees: { nom: entreprise.nom, corpsMetier: entreprise.corpsMetier },
      });
      return entreprise;
    });
  }

  async modifierEntreprise(entrepriseId: number, donnees: Partial<DonneesEntreprise>) {
    return this.db.run(async (tx) => {
      const existe = await tx.entreprise.findUnique({
        where: { id: entrepriseId },
        select: { id: true },
      });
      if (!existe) throw new NotFoundException(`Entreprise ${entrepriseId} introuvable.`);

      const entreprise = await tx.entreprise.update({
        where: { id: entrepriseId },
        data: donnees,
      });
      await this.audit.enregistrer(tx, {
        action: 'entreprise.modifiee',
        entite: 'Entreprise',
        entiteId: entrepriseId,
        donnees: { champs: Object.keys(donnees) },
      });
      return entreprise;
    });
  }

  // ===================================================================
  //  Soumissions
  // ===================================================================

  private async soumissionDeLOperation(tx: TenantDb, operationId: number, soumissionId: number) {
    const soumission = await tx.soumission.findFirst({
      where: { id: soumissionId, operationId },
      select: {
        id: true,
        intitule: true,
        statut: true,
        cfcNodeId: true,
        cfcNode: { select: { id: true, code: true, libelle: true } },
      },
    });
    if (!soumission) {
      throw new NotFoundException(`Soumission ${soumissionId} introuvable dans cette opération.`);
    }
    return soumission;
  }

  async listerSoumissions(operationId: number) {
    return this.db.run((tx) =>
      tx.soumission.findMany({
        where: { operationId },
        include: {
          cfcNode: { select: { id: true, code: true, libelle: true } },
          adjudication: {
            select: {
              id: true,
              montantAdjuge: true,
              dateDecision: true,
              offre: { select: { entreprise: { select: { id: true, nom: true } } } },
              contrat: { select: { id: true, reference: true, statut: true } },
            },
          },
          _count: { select: { offres: true, invitations: true } },
        },
        orderBy: { id: 'asc' },
      }),
    );
  }

  async creerSoumission(operationId: number, donnees: DonneesSoumission) {
    return this.db.run(async (tx) => {
      if (donnees.cfcNodeId) {
        const noeud = await tx.cfcNode.findFirst({
          where: { id: donnees.cfcNodeId, operationId },
          select: { id: true },
        });
        if (!noeud) throw new NotFoundException(`Poste CFC ${donnees.cfcNodeId} introuvable.`);
      }

      const soumission = await tx.soumission.create({ data: { operationId, ...donnees } });
      await this.audit.enregistrer(tx, {
        action: 'soumission.creee',
        entite: 'Soumission',
        entiteId: soumission.id,
        donnees: { operationId, intitule: soumission.intitule, cfcNodeId: soumission.cfcNodeId },
      });
      return soumission;
    });
  }

  async modifierSoumission(
    operationId: number,
    soumissionId: number,
    donnees: Partial<DonneesSoumission>,
  ) {
    let dateDeplacee: Date | null | undefined;
    const resultat = await this.db.run(async (tx) => {
      const avant = await this.soumissionDeLOperation(tx, operationId, soumissionId);
      if (avant.statut === 'ADJUGEE') {
        throw new BadRequestException(
          "Cette soumission est adjugée : elle n'est plus modifiable. Annuler l'adjudication d'abord.",
        );
      }

      const actuelle = await tx.soumission.findUniqueOrThrow({ where: { id: soumissionId } });
      const envoyee = ['ENVOYEE', 'OUVERTE'].includes(actuelle.statut);
      if (envoyee && donnees.offresScellees === false && actuelle.offresScellees) {
        // Desceller en cours de consultation ouvrirait les offres déjà
        // déposées avant l'heure promise aux entreprises.
        throw new BadRequestException(
          'Les entreprises ont été invitées sous pli scellé : ce choix ne se change plus.',
        );
      }
      if (
        envoyee &&
        donnees.dateLimite !== undefined &&
        actuelle.dateLimite &&
        (!donnees.dateLimite || donnees.dateLimite < actuelle.dateLimite)
      ) {
        // Avancer ou lever la date limite après l'envoi ouvrirait les plis
        // avant l'heure annoncée aux entreprises. On peut la repousser.
        throw new BadRequestException(
          'La date limite annoncée aux entreprises ne s’avance plus : elle peut seulement être repoussée.',
        );
      }
      const soumission = await tx.soumission.update({
        where: { id: soumissionId },
        data: donnees,
      });
      if (
        envoyee &&
        donnees.dateLimite !== undefined &&
        donnees.dateLimite?.getTime() !== actuelle.dateLimite?.getTime()
      ) {
        dateDeplacee = donnees.dateLimite ?? null;
      }
      await this.audit.enregistrer(tx, {
        action: 'soumission.modifiee',
        entite: 'Soumission',
        entiteId: soumissionId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return soumission;
    });
    // Un délai déplacé se dit à tous les invités, dans les mêmes termes.
    if (dateDeplacee !== undefined) {
      await this.consultation.informer(
        RequestContext.requireSocieteId(),
        soumissionId,
        'Date limite modifiée',
        dateDeplacee
          ? `La date limite de remise des offres est désormais fixée au ${dateDeplacee.toLocaleString('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'long', timeStyle: 'short' })}.`
          : 'La date limite de remise des offres a été levée.',
      );
    }
    return resultat;
  }

  /** Invite une entreprise à soumissionner. Idempotent : réinviter ne duplique pas. */
  async inviter(operationId: number, soumissionId: number, entrepriseId: number, dateEnvoi?: Date) {
    return this.db.run(async (tx) => {
      await this.soumissionDeLOperation(tx, operationId, soumissionId);
      const entreprise = await tx.entreprise.findUnique({
        where: { id: entrepriseId },
        select: { id: true, nom: true },
      });
      if (!entreprise) throw new NotFoundException(`Entreprise ${entrepriseId} introuvable.`);

      const invitation = await tx.soumissionInvitation.upsert({
        where: { soumissionId_entrepriseId: { soumissionId, entrepriseId } },
        create: { soumissionId, entrepriseId, dateEnvoi: dateEnvoi ?? new Date() },
        update: { dateEnvoi: dateEnvoi ?? new Date() },
      });

      await this.audit.enregistrer(tx, {
        action: 'soumission.entreprise_invitee',
        entite: 'SoumissionInvitation',
        entiteId: invitation.id,
        donnees: { operationId, soumissionId, entreprise: entreprise.nom },
      });
      return invitation;
    });
  }

  // ===================================================================
  //  Offres
  // ===================================================================

  /**
   * Enregistre ou met à jour l'offre d'une entreprise.
   *
   * Une entreprise n'a qu'une offre par soumission : recevoir un prix corrigé
   * met à jour l'offre existante plutôt que d'en créer une seconde, qui
   * fausserait la comparaison en comptant deux fois le même soumissionnaire.
   */
  async enregistrerOffre(operationId: number, soumissionId: number, donnees: DonneesOffre) {
    return this.db.run(async (tx) => {
      const soumission = await this.soumissionDeLOperation(tx, operationId, soumissionId);
      if (soumission.statut === 'ADJUGEE') {
        throw new BadRequestException(
          'Cette soumission est adjugée : les offres ne sont plus modifiables.',
        );
      }

      const entreprise = await tx.entreprise.findUnique({
        where: { id: donnees.entrepriseId },
        select: { id: true, nom: true },
      });
      if (!entreprise)
        throw new NotFoundException(`Entreprise ${donnees.entrepriseId} introuvable.`);

      const existante = await tx.offre.findFirst({
        where: { soumissionId, entrepriseId: donnees.entrepriseId },
        select: { id: true, source: true },
      });
      if (existante?.source === 'PORTAIL') {
        const etat = await tx.soumission.findUniqueOrThrow({ where: { id: soumissionId } });
        if (offreScellee(etat, existante)) {
          throw new BadRequestException(
            'Cette entreprise a déposé son offre elle-même : elle est scellée jusqu’à la date limite.',
          );
        }
        // Après ouverture, le promoteur peut changer le statut ou la note —
        // jamais les montants que l'entreprise a déposés.
        if (donnees.montant !== undefined || donnees.remisePct !== undefined) {
          throw new BadRequestException(
            'Les montants d’une offre déposée par l’entreprise ne se modifient pas.',
          );
        }
      }

      const offre = existante
        ? await tx.offre.update({ where: { id: existante.id }, data: donnees })
        : await tx.offre.create({ data: { soumissionId, ...donnees } });

      // Une offre reçue marque l'invitation comme ayant répondu.
      await tx.soumissionInvitation.updateMany({
        where: { soumissionId, entrepriseId: donnees.entrepriseId },
        data: { aRepondu: true },
      });

      await this.audit.enregistrer(tx, {
        action: existante ? 'offre.modifiee' : 'offre.recue',
        entite: 'Offre',
        entiteId: offre.id,
        donnees: {
          operationId,
          soumissionId,
          entreprise: entreprise.nom,
          montant: offre.montant,
        },
      });
      return offre;
    });
  }

  // ===================================================================
  //  Comparaison
  // ===================================================================

  /**
   * Le tableau comparatif d'une soumission.
   *
   * Le budget de référence est le **total du poste CFC dans la version
   * courante**, sous-postes compris : une soumission de plâtrerie se compare
   * au budget de la plâtrerie, pas à la seule ligne saisie sur le poste.
   */
  async comparaison(operationId: number, soumissionId: number) {
    const { soumission, offres, budgete } = await this.db.run(async (tx) => {
      const soumission = await tx.soumission.findFirst({
        where: { id: soumissionId, operationId },
        include: {
          cfcNode: { select: { id: true, code: true, libelle: true } },
          adjudication: { select: { id: true, offreId: true, montantAdjuge: true } },
        },
      });
      if (!soumission) {
        throw new NotFoundException(`Soumission ${soumissionId} introuvable dans cette opération.`);
      }

      const offres = await tx.offre.findMany({
        where: { soumissionId },
        include: {
          entreprise: { select: { id: true, nom: true } },
          lignes: { orderBy: { id: 'asc' } },
          notes: true,
          documents: {
            where: { isCourant: true },
            select: { id: true, fileName: true, createdAt: true },
          },
        },
        orderBy: { id: 'asc' },
      });

      let budgete: Prisma.Decimal | null = null;
      if (soumission.cfcNodeId) {
        // Descendance du poste, pour comparer à un budget complet.
        const noeuds = await tx.cfcNode.findMany({
          where: { operationId },
          select: { id: true, parentId: true },
        });
        const descendants = new Set<number>([soumission.cfcNodeId]);
        let ajoute = true;
        while (ajoute) {
          ajoute = false;
          for (const n of noeuds) {
            if (n.parentId !== null && descendants.has(n.parentId) && !descendants.has(n.id)) {
              descendants.add(n.id);
              ajoute = true;
            }
          }
        }

        const lignes = await tx.ligneBudget.findMany({
          where: {
            cfcNodeId: { in: [...descendants] },
            budgetVersion: { operationId, isCourant: true },
          },
          select: { montant: true },
        });
        budgete = lignes.reduce<Prisma.Decimal>((t, l) => t.plus(l.montant), ZERO);
      }

      return { soumission, offres, budgete };
    });

    // Une offre scellée entre dans le tableau sans son contenu : on sait
    // qu'elle est là, on ne sait pas ce qu'elle dit.
    const maintenant = new Date();
    const scellees = new Set(
      offres.filter((o) => offreScellee(soumission, o, maintenant)).map((o) => o.id),
    );
    const sources: OffreSource[] = offres.map((o) => ({
      id: o.id,
      entrepriseId: o.entrepriseId,
      entrepriseNom: o.entreprise.nom,
      montant: scellees.has(o.id) ? null : o.montant,
      remisePct: scellees.has(o.id) ? null : o.remisePct,
      statut: o.statut,
      dateReception: o.dateReception,
    }));
    const comparaison = comparerOffres(sources, budgete);
    const criteres = await this.db.run((tx) =>
      tx.critereSoumission.findMany({ where: { soumissionId }, orderBy: { ordre: 'asc' } }),
    );
    const invitations = await this.db.run((tx) =>
      tx.soumissionInvitation.findMany({
        where: { soumissionId },
        select: {
          id: true,
          entrepriseId: true,
          email: true,
          dateEnvoi: true,
          consulteeLe: true,
          aRepondu: true,
          relanceLe: true,
          refuseLe: true,
          motifRefus: true,
          revoqueeLe: true,
          jetonHash: true,
          entreprise: { select: { nom: true, email: true } },
        },
        orderBy: { id: 'asc' },
      }),
    );

    return {
      soumission: {
        id: soumission.id,
        intitule: soumission.intitule,
        corpsMetier: soumission.corpsMetier,
        statut: soumission.statut,
        dateLimite: soumission.dateLimite,
        cfcNode: soumission.cfcNode,
      },
      dossier: {
        descriptif: soumission.descriptif,
        conditions: soumission.conditions,
        delaiExecution: soumission.delaiExecution,
        offresScellees: soumission.offresScellees,
        dateEnvoi: soumission.dateEnvoi,
      },
      adjudication: soumission.adjudication,
      criteres,
      invitations: invitations.map(({ jetonHash, ...i }) => ({ ...i, lienEnvoye: !!jetonHash })),
      ...comparaison,
      offres: comparaison.offres.map((c) => {
        const o = offres.find((x) => x.id === c.id)!;
        const scellee = scellees.has(o.id);
        const score = scorer(o.id, criteres, new Map(o.notes.map((n) => [n.critereId, n.note])), {
          net: c.motifExclusion ? null : c.montantNet,
          moinsDisant: comparaison.moinsDisant,
        });
        return {
          ...c,
          source: o.source,
          scellee,
          motifExclusion: scellee ? 'Scellée jusqu’à la date limite' : c.motifExclusion,
          note: scellee ? null : o.note,
          lignes: scellee ? [] : o.lignes,
          documents: scellee ? [] : o.documents,
          notes: scellee ? [] : o.notes,
          score: scellee || !criteres.length ? null : score,
        };
      }),
      // Tant qu'une offre est scellée, rien ne s'adjuge : ce serait décider
      // sans avoir tout lu.
      adjudicable: scellees.size === 0,
    };
  }
}
