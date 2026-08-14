import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type WebhookEventStatut } from '@prisma/client';
import { ZodError } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { KolabimoClient } from './kolabimo.client';
import { construireDedupeKey, verifier } from './signature';
import {
  calculerPrixTotalDepuisLot,
  enveloppeSchema,
  estEngage,
  lotSchema,
  planifierMiseAJour,
  reservationSchema,
  statutDepuisKolabimo,
  type DonneesReservation,
} from './reconciliation';

export const SOURCE_ENTRANTE = 'kolabimo';
export const SOURCE_SORTANTE = 'prometis';

export interface ResultatReception {
  recu: true;
  dejaTraite: boolean;
  evenement: string;
  statut: WebhookEventStatut;
  detail?: unknown;
}

interface Traitement {
  statut: WebhookEventStatut;
  detail: Record<string, unknown>;
  erreur?: string;
}

@Injectable()
export class PasserelleService {
  private readonly logger = new Logger(PasserelleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly kolabimo: KolabimoClient,
  ) {}

  // ===================================================================
  //  Entrant — Kolabimo → Prometis
  // ===================================================================

  /**
   * Point d'entrée unique des webhooks Kolabimo.
   *
   * L'ordre des étapes n'est pas cosmétique :
   *
   *   1. **Authentifier avant de journaliser.** Une charge non signée n'entre
   *      pas dans le journal : n'importe qui pourrait sinon le remplir.
   *   2. **Journaliser avant de traiter.** La `dedupeKey` est unique en base ;
   *      c'est l'insertion elle-même qui fait le dédoublonnage, pas une
   *      lecture préalable — deux livraisons simultanées ne peuvent pas passer
   *      toutes les deux.
   *   3. **Traiter, puis conclure.** Un traitement en échec laisse l'événement
   *      en ERREUR avec sa raison, rejouable à la main. Il n'est pas retraité
   *      tout seul à la livraison suivante : rejouer une erreur non comprise
   *      est le meilleur moyen de la répéter.
   */
  async recevoir(entree: {
    cleApi: string | undefined;
    signature: string | undefined;
    corpsBrut: string;
  }): Promise<ResultatReception> {
    const { societeId } = await this.resoudreTenant(entree.cleApi);

    const controle = verifier({
      secret: entree.cleApi as string,
      corpsBrut: entree.corpsBrut,
      entete: entree.signature,
    });
    if (!controle.valide) {
      // Même message pour toutes les causes : distinguer « signature
      // invalide » de « horodatage périmé » aide surtout celui qui sonde.
      this.logger.warn(`Webhook Kolabimo rejeté : ${controle.raison}`);
      throw new UnauthorizedException('Signature du webhook invalide.');
    }

    let enveloppe: ReturnType<typeof enveloppeSchema.parse>;
    try {
      enveloppe = enveloppeSchema.parse(JSON.parse(entree.corpsBrut));
    } catch (erreur) {
      throw new BadRequestException(
        `Charge du webhook illisible : ${erreur instanceof Error ? erreur.message : 'JSON invalide'}`,
      );
    }

    const dedupeKey = construireDedupeKey({
      source: SOURCE_ENTRANTE,
      evenement: enveloppe.evenement,
      idEvenement: enveloppe.idEvenement,
      corpsBrut: entree.corpsBrut,
    });

    const charge = {
      societeId,
      evenement: enveloppe.evenement,
      idEvenement: enveloppe.idEvenement ?? null,
      emisLe: enveloppe.emisLe?.toISOString() ?? null,
      donnees: enveloppe.donnees,
    };

    let evenementId: number;
    try {
      const cree = await this.prisma.webhookEvent.create({
        data: {
          source: SOURCE_ENTRANTE,
          evenement: enveloppe.evenement,
          dedupeKey,
          payload: charge as unknown as Prisma.InputJsonValue,
          statut: 'RECU',
        },
        select: { id: true },
      });
      evenementId = cree.id;
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
        const existant = await this.prisma.webhookEvent.findUnique({
          where: { dedupeKey },
          select: { evenement: true, statut: true },
        });
        return {
          recu: true,
          dejaTraite: true,
          evenement: existant?.evenement ?? enveloppe.evenement,
          statut: existant?.statut ?? 'RECU',
        };
      }
      throw erreur;
    }

    const traitement = await this.traiter(societeId, enveloppe.evenement, enveloppe.donnees);
    await this.conclure(evenementId, traitement);

    return {
      recu: true,
      dejaTraite: false,
      evenement: enveloppe.evenement,
      statut: traitement.statut,
      detail: traitement.detail,
    };
  }

  /**
   * Retrouve le tenant depuis la clé d'API présentée.
   *
   * `api_keys` est protégée par la RLS, donc illisible sans tenant — et le
   * tenant est justement ce qu'on cherche. D'où la fonction SECURITY DEFINER
   * posée par la migration du Lot 7, scopée à la clé passée.
   */
  private async resoudreTenant(cleApi: string | undefined): Promise<{ societeId: number }> {
    if (!cleApi) throw new UnauthorizedException('Clé d’API absente.');

    const lignes = await this.prisma.$queryRaw<{ api_key_id: number; societe_id: number }[]>`
      SELECT api_key_id, societe_id FROM app.societe_de_cle_api(${cleApi})
    `;
    const ligne = lignes[0];
    if (!ligne) throw new UnauthorizedException('Clé d’API inconnue ou révoquée.');

    // Trace d'usage : utile pour repérer une clé oubliée en production.
    await this.db
      .runInTenant(ligne.societe_id, (tx) =>
        tx.apiKey.update({ where: { id: ligne.api_key_id }, data: { lastUsedAt: new Date() } }),
      )
      .catch((erreur: unknown) => {
        this.logger.warn(
          `Horodatage d'usage de la clé ${ligne.api_key_id} non enregistré : ${String(erreur)}`,
        );
      });

    return { societeId: ligne.societe_id };
  }

  private async traiter(
    societeId: number,
    evenement: string,
    donnees: unknown,
  ): Promise<Traitement> {
    try {
      switch (evenement) {
        case 'reservation.created':
        case 'reservation.updated':
        case 'reservation.cancelled':
          return await this.appliquerReservation(societeId, reservationSchema.parse(donnees));
        case 'lot.updated':
          return await this.appliquerLot(societeId, lotSchema.parse(donnees));
        default:
          return {
            statut: 'IGNORE',
            detail: { raison: `Événement « ${evenement} » non pris en charge.` },
          };
      }
    } catch (erreur) {
      const message = messageLisible(erreur);
      this.logger.error(`Webhook ${evenement} en erreur : ${message}`);
      return { statut: 'ERREUR', detail: {}, erreur: message };
    }
  }

  /**
   * Clôt un événement : statut, raison, et détail du traitement ajouté à la
   * charge d'origine.
   *
   * En une seule instruction : conclure en deux temps laisserait, si le
   * processus tombe entre les deux, un événement dit « traité » dont le
   * journal ne raconte rien.
   */
  private async conclure(evenementId: number, traitement: Traitement): Promise<void> {
    const detail = JSON.stringify({ traitement: traitement.detail });
    await this.prisma.$executeRaw`
      UPDATE public.webhook_events
      SET statut       = ${traitement.statut}::"WebhookEventStatut",
          erreur       = ${traitement.erreur ?? null},
          processed_at = now(),
          payload      = payload || ${detail}::jsonb
      WHERE id = ${evenementId}
    `;
  }

  // --- Réservations ----------------------------------------------------

  private async appliquerReservation(
    societeId: number,
    donnees: DonneesReservation,
  ): Promise<Traitement> {
    return this.db.runInTenant(societeId, async (tx) => {
      const operation = await tx.operation.findFirst({
        where: { kolabimoPromotionId: donnees.promotionId },
        select: { id: true, nom: true },
      });
      if (!operation) {
        // Kolabimo pousse toutes ses promotions ; celles qu'on ne pilote pas
        // ne sont pas une erreur, juste hors périmètre.
        return {
          statut: 'IGNORE' as const,
          detail: { raison: `Promotion Kolabimo ${donnees.promotionId} non rattachée.` },
        };
      }

      const lot = await tx.lot.findFirst({
        where: {
          kolabimoAppartementId: donnees.appartementId,
          bien: { operationId: operation.id },
        },
        select: {
          id: true,
          reference: true,
          prixVente: true,
          parkings: { select: { prix: true } },
        },
      });
      if (!lot) {
        throw new Error(
          `Appartement Kolabimo ${donnees.appartementId} introuvable dans « ${operation.nom} ». ` +
            `Rattacher le lot (kolabimoAppartementId) avant de rejouer.`,
        );
      }

      const acquereurId = await this.acquereurRapproche(tx, societeId, donnees);

      const existante = await tx.reservation.findUnique({
        where: { externalId: donnees.externalId },
        select: {
          id: true,
          operationId: true,
          statut: true,
          prixTotalActe: true,
          dateSignatureActe: true,
          _count: { select: { appelsDeFonds: true } },
        },
      });

      if (!existante) {
        const prixTotalActe =
          donnees.prixTotalActe ??
          calculerPrixTotalDepuisLot(
            lot.prixVente,
            lot.parkings.map((p) => p.prix),
          );

        const creee = await tx.reservation.create({
          data: {
            operationId: operation.id,
            lotId: lot.id,
            acquereurId,
            statut: statutDepuisKolabimo(donnees.statut),
            prixTotalActe,
            dateReservation: donnees.dateReservation ?? new Date(),
            dateSignatureActe: donnees.dateSignatureActe ?? null,
            externalId: donnees.externalId,
            kolabimoReservationId: donnees.reservationId ?? null,
          },
          select: { id: true, statut: true },
        });

        await this.audit.enregistrerAutomatique(tx, societeId, {
          action: 'passerelle.reservation_creee',
          entite: 'Reservation',
          entiteId: creee.id,
          donnees: {
            operationId: operation.id,
            lot: lot.reference,
            externalId: donnees.externalId,
            statut: creee.statut,
            prixTotalActe,
            source: SOURCE_ENTRANTE,
          },
        });

        return {
          statut: 'TRAITE' as const,
          detail: {
            action: 'creee',
            reservationId: creee.id,
            lot: lot.reference,
            statut: creee.statut,
            prixTotalActe: prixTotalActe?.toFixed(2) ?? null,
            engagee: estEngage(creee.statut),
          },
        };
      }

      const plan = planifierMiseAJour(
        {
          statut: existante.statut,
          prixTotalActe: existante.prixTotalActe,
          dateSignatureActe: existante.dateSignatureActe,
          appelsEmis: existante._count.appelsDeFonds,
        },
        donnees,
      );

      if (plan.bloquant) {
        // Marqué en erreur exprès : cet événement doit se voir à l'écran.
        throw new Error(plan.bloquant);
      }

      if (Object.keys(plan.champs).length > 0) {
        await tx.reservation.update({ where: { id: existante.id }, data: plan.champs });
        await this.audit.enregistrerAutomatique(tx, societeId, {
          action: 'passerelle.reservation_mise_a_jour',
          entite: 'Reservation',
          entiteId: existante.id,
          donnees: {
            operationId: operation.id,
            externalId: donnees.externalId,
            champs: Object.keys(plan.champs),
            refus: plan.refus,
            source: SOURCE_ENTRANTE,
          },
        });
      }

      return {
        statut: 'TRAITE' as const,
        detail: {
          action: Object.keys(plan.champs).length > 0 ? 'mise_a_jour' : 'sans_changement',
          reservationId: existante.id,
          lot: lot.reference,
          champs: Object.keys(plan.champs),
          refus: plan.refus,
        },
      };
    });
  }

  /** Retrouve l'acquéreur par sa référence Kolabimo, ou le crée. */
  private async acquereurRapproche(
    tx: TenantDb,
    societeId: number,
    donnees: DonneesReservation,
  ): Promise<number> {
    const client = donnees.client;
    const existant = await tx.acquereur.findFirst({
      where: { kolabimoClientRef: client.ref },
      select: { id: true },
    });

    const champs = {
      nom: client.nom ?? null,
      prenom: client.prenom ?? null,
      email: client.email ?? null,
      telephone: client.telephone ?? null,
      adresse: client.adresse ?? null,
    };

    if (existant) {
      // Kolabimo est maître du client : on recopie, sans rien inventer.
      await tx.acquereur.update({ where: { id: existant.id }, data: champs });
      return existant.id;
    }

    const cree = await tx.acquereur.create({
      data: { societeId, kolabimoClientRef: client.ref, ...champs },
      select: { id: true },
    });
    return cree.id;
  }

  // --- Lots -------------------------------------------------------------

  private async appliquerLot(
    societeId: number,
    donnees: ReturnType<typeof lotSchema.parse>,
  ): Promise<Traitement> {
    return this.db.runInTenant(societeId, async (tx) => {
      const operation = await tx.operation.findFirst({
        where: { kolabimoPromotionId: donnees.promotionId },
        select: { id: true, nom: true },
      });
      if (!operation) {
        return {
          statut: 'IGNORE' as const,
          detail: { raison: `Promotion Kolabimo ${donnees.promotionId} non rattachée.` },
        };
      }

      const lot = await tx.lot.findFirst({
        where: {
          kolabimoAppartementId: donnees.appartementId,
          bien: { operationId: operation.id },
        },
        select: { id: true, reference: true },
      });
      if (!lot) {
        throw new Error(
          `Appartement Kolabimo ${donnees.appartementId} introuvable dans « ${operation.nom} ».`,
        );
      }

      if (donnees.prixVente) {
        await tx.lot.update({ where: { id: lot.id }, data: { prixVente: donnees.prixVente } });
      }
      for (const parking of donnees.parkings ?? []) {
        if (!parking.prix) continue;
        await tx.parking.updateMany({
          where: { kolabimoParkingId: parking.parkingId, lotId: lot.id },
          data: { prix: parking.prix },
        });
      }

      // Le prix du lot bouge, mais PAS l'assiette des réservations déjà
      // engagées : `prixTotalActe` est figé à la vente (CLAUDE.md §5). Un
      // nouveau prix ne vaut donc que pour les ventes à venir.
      const engagees = await tx.reservation.count({
        where: { lotId: lot.id, statut: { in: ['RESERVE', 'FONDS_VERSES', 'VENDU'] } },
      });

      await this.audit.enregistrerAutomatique(tx, societeId, {
        action: 'passerelle.lot_mis_a_jour',
        entite: 'Lot',
        entiteId: lot.id,
        donnees: {
          operationId: operation.id,
          reference: lot.reference,
          prixVente: donnees.prixVente,
          parkings: donnees.parkings?.length ?? 0,
          source: SOURCE_ENTRANTE,
        },
      });

      return {
        statut: 'TRAITE' as const,
        detail: {
          lot: lot.reference,
          prixVente: donnees.prixVente?.toFixed(2) ?? null,
          parkingsMisAJour: donnees.parkings?.length ?? 0,
          reservationsEngageesInchangees: engagees,
        },
      };
    });
  }

  // ===================================================================
  //  Reprise tirée — pour le premier raccordement et après une coupure
  // ===================================================================

  /**
   * Tire les réservations d'une promotion Kolabimo et les applique.
   *
   * Les webhooks tiennent le fil de l'eau ; ce tirage tient le reste : premier
   * raccordement, coupure, événement perdu. Il emprunte **le même chemin** que
   * les webhooks — mêmes verrous sur le prix figé, même audit — parce qu'un
   * second chemin d'écriture finirait par diverger du premier.
   */
  async importerReservations(societeId: number, operationId: number) {
    const operation = await this.db.runInTenant(societeId, (tx) =>
      tx.operation.findUnique({
        where: { id: operationId },
        select: { id: true, nom: true, kolabimoPromotionId: true },
      }),
    );
    if (!operation) throw new NotFoundException(`Opération ${operationId} introuvable.`);
    if (!operation.kolabimoPromotionId) {
      throw new BadRequestException(
        `L'opération « ${operation.nom} » n'est rattachée à aucune promotion Kolabimo ` +
          `(kolabimoPromotionId non renseigné).`,
      );
    }

    const reponse = await this.kolabimo.listerReservations(operation.kolabimoPromotionId);
    if (!reponse.livre) {
      throw new BadRequestException(reponse.raison ?? 'Kolabimo injoignable.');
    }

    const brutes = Array.isArray(reponse.corps)
      ? reponse.corps
      : ((reponse.corps as { reservations?: unknown[] } | undefined)?.reservations ?? []);

    const resultats: { externalId?: string; statut: WebhookEventStatut; detail: unknown }[] = [];
    for (const brute of brutes) {
      const analyse = reservationSchema.safeParse(brute);
      if (!analyse.success) {
        resultats.push({
          statut: 'ERREUR',
          detail: { raison: analyse.error.issues.map((i) => i.message).join(' · ') },
        });
        continue;
      }
      // Séquentiel et non parallèle : deux réservations du même acquéreur
      // créeraient deux fiches si elles se croisaient.
      const traitement = await this.traiter(societeId, 'reservation.updated', brute);
      resultats.push({
        externalId: analyse.data.externalId,
        statut: traitement.statut,
        detail: traitement.erreur ?? traitement.detail,
      });
    }

    return {
      promotionKolabimo: operation.kolabimoPromotionId,
      recues: brutes.length,
      traitees: resultats.filter((r) => r.statut === 'TRAITE').length,
      enErreur: resultats.filter((r) => r.statut === 'ERREUR').length,
      resultats,
    };
  }

  // ===================================================================
  //  Sortant — Prometis → Kolabimo (boîte d'envoi)
  // ===================================================================

  /**
   * Dépose un événement sortant **dans la transaction métier**.
   *
   * C'est le motif de la boîte d'envoi : l'événement est enregistré avec le
   * changement qui le produit, donc il ne peut pas exister sans lui — ni
   * l'inverse. La livraison, elle, se fait après le commit, et son échec ne
   * remet rien en cause : l'événement reste en attente, rejouable.
   */
  async deposerSortant(
    tx: TenantDb,
    options: {
      evenement: string;
      cle: string;
      societeId: number;
      donnees: Record<string, unknown>;
    },
  ): Promise<number> {
    const dedupeKey = construireDedupeKey({
      source: SOURCE_SORTANTE,
      evenement: options.evenement,
      idEvenement: options.cle,
    });

    const charge = {
      societeId: options.societeId,
      evenement: options.evenement,
      donnees: options.donnees,
    } as unknown as Prisma.InputJsonValue;

    // `upsert` et non `create` : rejouer le même geste métier ne doit pas
    // produire deux messages sortants pour un seul événement réel.
    const evenement = await tx.webhookEvent.upsert({
      where: { dedupeKey },
      create: {
        source: SOURCE_SORTANTE,
        evenement: options.evenement,
        dedupeKey,
        payload: charge,
        statut: 'RECU',
      },
      update: { payload: charge },
      select: { id: true },
    });
    return evenement.id;
  }

  /** Tente la livraison d'un événement en attente. Ne lève jamais. */
  async livrer(evenementId: number): Promise<{ livre: boolean; raison?: string }> {
    const evenement = await this.prisma.webhookEvent.findUnique({
      where: { id: evenementId },
      select: { id: true, evenement: true, payload: true, source: true },
    });
    if (!evenement || evenement.source !== SOURCE_SORTANTE) {
      return { livre: false, raison: 'Événement sortant introuvable.' };
    }

    const charge = (evenement.payload ?? {}) as { donnees?: Record<string, unknown> };
    const resultat = await this.kolabimo.publierEvenement(
      evenement.evenement,
      charge.donnees ?? {},
    );

    await this.prisma.webhookEvent.update({
      where: { id: evenementId },
      data: {
        statut: resultat.livre ? 'TRAITE' : 'ERREUR',
        erreur: resultat.livre ? null : (resultat.raison ?? 'Livraison impossible'),
        processedAt: new Date(),
      },
    });

    return { livre: resultat.livre, raison: resultat.raison };
  }

  // ===================================================================
  //  Journal
  // ===================================================================

  /**
   * Journal de synchronisation d'une société.
   *
   * `webhook_events` est l'une des deux tables exemptées de RLS — un événement
   * entrant est journalisé avant qu'on sache toujours à qui il appartient.
   * L'étanchéité est donc **applicative** : on filtre sur la société inscrite
   * dans la charge. C'est un test qui tient cette promesse, pas PostgreSQL.
   */
  async journal(
    societeId: number,
    options: { limite?: number; statut?: WebhookEventStatut; source?: string } = {},
  ) {
    const limite = Math.min(Math.max(options.limite ?? 50, 1), 200);
    return this.prisma.webhookEvent.findMany({
      where: {
        payload: { path: ['societeId'], equals: societeId },
        ...(options.statut ? { statut: options.statut } : {}),
        ...(options.source ? { source: options.source } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: limite,
    });
  }

  /** Rejoue un événement du journal — entrant retraité, sortant relivré. */
  async rejouer(societeId: number, evenementId: number) {
    const evenement = await this.prisma.webhookEvent.findFirst({
      where: { id: evenementId, payload: { path: ['societeId'], equals: societeId } },
    });
    if (!evenement) throw new NotFoundException(`Événement ${evenementId} introuvable.`);

    if (evenement.source === SOURCE_SORTANTE) {
      const resultat = await this.livrer(evenementId);
      return { rejoue: true, sens: 'sortant', ...resultat };
    }

    const charge = evenement.payload as { evenement?: string; donnees?: unknown } | null;
    const traitement = await this.traiter(
      societeId,
      charge?.evenement ?? evenement.evenement,
      charge?.donnees,
    );
    await this.conclure(evenementId, traitement);
    return { rejoue: true, sens: 'entrant', statut: traitement.statut, detail: traitement.detail };
  }

  /** État de la passerelle, pour l'écran de configuration. */
  async etat(societeId: number) {
    const [parStatut, cles] = await Promise.all([
      this.prisma.webhookEvent.groupBy({
        by: ['source', 'statut'],
        where: { payload: { path: ['societeId'], equals: societeId } },
        _count: { _all: true },
      }),
      this.db.runInTenant(societeId, (tx) =>
        tx.apiKey.findMany({
          where: { isActive: true },
          select: { id: true, label: true, lastUsedAt: true, createdAt: true },
        }),
      ),
    ]);

    return {
      sortant: this.kolabimo.description,
      // La clé n'est jamais renvoyée : elle sert aussi de secret de signature.
      clesEntrantes: cles,
      compteurs: parStatut.map((l) => ({
        source: l.source,
        statut: l.statut,
        nombre: l._count._all,
      })),
    };
  }
}

/**
 * Message d'erreur destiné au journal, donc à un humain.
 *
 * Une `ZodError` brute s'affiche en JSON illisible ; ce journal est consulté
 * par un chef de projet qui doit comprendre pourquoi une réservation n'est
 * pas passée, pas déchiffrer une trace d'analyseur.
 */
function messageLisible(erreur: unknown): string {
  if (erreur instanceof ZodError) {
    return `Charge invalide — ${erreur.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join(' · ')}`;
  }
  return erreur instanceof Error ? erreur.message : 'Traitement impossible';
}
