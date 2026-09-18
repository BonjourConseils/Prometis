import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AppModule, Prisma, StatutSouscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CATALOGUE, SOCLE, moduleCommercial, modulesTechniques } from './catalogue';

export type Source = 'ADMIN' | 'STRIPE' | 'REPRISE';

export interface ChangementModule {
  source: Source;
  /** Obligatoire pour un geste de l'exploitant. */
  raison?: string;
  parCompteId?: number;
  finEssai?: Date;
  montantCentimes?: number;
  stripeSubscriptionItemId?: string | null;
}

/**
 * L'état des modules d'une société, et le **seul** endroit qui l'écrit.
 *
 * `Societe.modulesActifs` et `modulesLecture` sont dérivés des souscriptions.
 * Les écrire ailleurs — à la main, dans un seed, dans un contrôleur — ouvrirait
 * un module sans souscription, donc sans facture. `recalculer` est l'unique
 * écrivain, et il est appelé dans la transaction de chaque changement.
 */
@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Ce que la société a, ce qu'elle pourrait avoir, et depuis quand. */
  async etat(societeId: number) {
    return this.db.runInTenant(societeId, async (tx) => {
      // L'état affiché est celui qui s'appliquerait maintenant : un essai
      // échu depuis hier ne doit pas s'afficher « actif » jusqu'au prochain
      // geste qui recalcule.
      await this.rafraichir(tx, societeId);
      const societe = await tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: {
          raisonSociale: true,
          profil: true,
          modulesActifs: true,
          modulesLecture: true,
          souscriptions: true,
          historiqueModules: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      const parCode = new Map(societe.souscriptions.map((s) => [s.module, s]));
      return {
        societe: { id: societeId, raisonSociale: societe.raisonSociale, profil: societe.profil },
        socle: SOCLE,
        modules: CATALOGUE.map((m) => {
          const s = parCode.get(m.code);
          return {
            code: m.code,
            libelle: m.libelle,
            promesse: m.promesse,
            seul: m.seul ?? null,
            techniques: m.techniques,
            eligible: m.profils.includes(societe.profil),
            statut: s?.statut ?? ('NON_SOUSCRIT' as const),
            depuis: s?.depuis ?? null,
            finEssai: s?.finEssai ?? null,
            resilieLe: s?.resilieLe ?? null,
          };
        }),
        modulesActifs: societe.modulesActifs,
        modulesLecture: societe.modulesLecture,
        historique: societe.historiqueModules,
      };
    });
  }

  /**
   * Change l'état d'un module commercial pour une société.
   *
   * Tout passe ici : le geste de l'exploitant aujourd'hui, le webhook Stripe
   * demain. Même historique, même audit, même recalcul — deux chemins
   * d'écriture finiraient par ouvrir des accès différents pour le même état.
   */
  async changer(
    societeId: number,
    code: string,
    vers: StatutSouscription,
    options: ChangementModule,
  ) {
    const module = moduleCommercial(code);
    if (!module) throw new NotFoundException(`Module « ${code} » inconnu.`);
    if (options.source === 'ADMIN' && (options.raison?.trim().length ?? 0) < 10) {
      throw new BadRequestException(
        'Un geste de l’exploitant s’explique : une raison d’au moins dix caractères est requise.',
      );
    }
    if (vers === 'ESSAI' && (!options.finEssai || options.finEssai <= new Date())) {
      throw new BadRequestException('Un essai porte une date de fin, dans le futur.');
    }

    await this.db.runInTenant(societeId, async (tx) => {
      const societe = await tx.societe.findUnique({
        where: { id: societeId },
        select: { profil: true },
      });
      if (!societe) throw new NotFoundException(`Société ${societeId} introuvable.`);
      if (!module.profils.includes(societe.profil)) {
        throw new BadRequestException(
          `« ${module.libelle} » ne s'adresse pas à une société de profil ${societe.profil.toLowerCase().replace(/_/g, ' ')}.`,
        );
      }

      const avant = await tx.souscriptionModule.findUnique({
        where: { societeId_module: { societeId, module: code } },
      });
      if (avant?.statut === vers && vers !== 'ESSAI') {
        throw new BadRequestException(`« ${module.libelle} » est déjà dans cet état.`);
      }

      const maintenant = new Date();
      const donnees: Prisma.SouscriptionModuleUncheckedCreateInput = {
        societeId,
        module: code,
        statut: vers,
        source: options.source,
        // `depuis` date l'ouverture : il ne bouge pas quand on résilie, pour
        // que l'historique dise « actif du … au … ».
        depuis: vers === 'RESILIE' ? (avant?.depuis ?? maintenant) : maintenant,
        finEssai: vers === 'ESSAI' ? options.finEssai! : null,
        resilieLe: vers === 'RESILIE' ? maintenant : null,
        ...(options.stripeSubscriptionItemId !== undefined
          ? { stripeSubscriptionItemId: options.stripeSubscriptionItemId }
          : {}),
      };
      await tx.souscriptionModule.upsert({
        where: { societeId_module: { societeId, module: code } },
        create: donnees,
        update: donnees,
      });

      await tx.historiqueModule.create({
        data: {
          societeId,
          module: code,
          de: avant?.statut ?? null,
          vers,
          source: options.source,
          raison: options.raison?.trim() ?? null,
          parCompteId: options.parCompteId ?? null,
          montantCentimes: options.montantCentimes ?? null,
        },
      });

      const ouverts = await this.recalculer(tx, societeId);

      // Automatique au sens de l'audit : l'auteur n'est pas un membre de la
      // société. Qui l'a fait est dans l'historique (`parCompteId`).
      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: `module.${vers.toLowerCase()}`,
        entite: 'SouscriptionModule',
        donnees: {
          module: code,
          de: avant?.statut ?? null,
          vers,
          source: options.source,
          raison: options.raison ?? null,
          parCompteId: options.parCompteId ?? null,
          modulesActifs: ouverts.actifs,
        },
      });
    });

    return this.etat(societeId);
  }

  /** Recalcule, et n'écrit que si la valeur stockée a dérivé. */
  private async rafraichir(tx: TenantDb, societeId: number): Promise<void> {
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
    const cle = (a: readonly string[]) => [...a].sort().join(',');
    if (
      cle(ouverts.actifs) !== cle(societe.modulesActifs) ||
      cle(ouverts.lecture) !== cle(societe.modulesLecture)
    ) {
      await tx.societe.update({
        where: { id: societeId },
        data: { modulesActifs: ouverts.actifs, modulesLecture: ouverts.lecture },
      });
    }
  }

  /**
   * Réécrit `modulesActifs` et `modulesLecture` depuis les souscriptions.
   * L'unique écrivain de ces deux colonnes, avec `rafraichir`.
   */
  async recalculer(
    tx: TenantDb,
    societeId: number,
  ): Promise<{ actifs: AppModule[]; lecture: AppModule[] }> {
    const societe = await tx.societe.findUniqueOrThrow({
      where: { id: societeId },
      select: {
        profil: true,
        souscriptions: { select: { module: true, statut: true, finEssai: true } },
      },
    });
    const ouverts = modulesTechniques(societe.souscriptions, societe.profil);
    await tx.societe.update({
      where: { id: societeId },
      data: { modulesActifs: ouverts.actifs, modulesLecture: ouverts.lecture },
    });
    return ouverts;
  }

  // ===================================================================
  //  Exploitant
  // ===================================================================

  /**
   * Les sociétés de la plateforme — nom, profil, modules, et rien d'autre.
   * La fonction SECURITY DEFINER ne rend aucun contenu client.
   */
  async societesPourExploitant() {
    return this.prisma.$queryRaw<
      {
        id: number;
        raison_sociale: string;
        profil: string;
        modules_actifs: string[];
        modules_lecture: string[];
      }[]
    >`SELECT id, raison_sociale, profil, modules_actifs, modules_lecture FROM app.societes_pour_exploitant()`;
  }
}
