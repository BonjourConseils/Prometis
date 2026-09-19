import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { loadEnv, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { ModulesService } from '../modules/modules.service';
import { CATALOGUE, moduleCommercial } from '../modules/catalogue';
import {
  AVANCE_AVERTISSEMENT_MS,
  DUREE_ESSAI_JOURS,
  abonnementVivant,
  apercuValide,
  essaiAEcrire,
  essaiPermis,
  lireAbonnement,
  statutModule,
  tarifVendable,
  type Tarif,
} from './regles';
import { abonnementConfirme, essaiDemarre, finEssaiProche, type Courriel } from './emails';

/** Épinglée : les versions récentes déplacent des champs sans prévenir (skill plans-payants). */
const VERSION_API_STRIPE = '2026-08-26.dahlia';

/** Les événements traités. À comparer à `enabled_events` du webhook avant d'ouvrir. */
export const EVENEMENTS_TRAITES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
] as const;

const FERMEE =
  'La souscription en ligne est momentanément fermée. Écrivez-nous à contact@prometis.ch : ' +
  'nous ouvrons le module pour vous.';

/**
 * La facturation par module, avec Stripe.
 *
 * Un abonnement par société, un élément par module. Ce service ne change
 * JAMAIS un module lui-même : il lit Stripe, puis demande à
 * `ModulesService.changer` — l'écrivain unique, celui que l'exploitant
 * utilise aussi. Deux chemins d'écriture ouvriraient des accès différents
 * pour le même état.
 *
 * Règles tenues (skill `plans-payants`) : un clic ne facture jamais — tout
 * ajout passe par un aperçu Stripe, et le serveur refuse un ajout sans aperçu
 * récent ; le montant vient de Stripe ; un seul abonnement par société ; une
 * résiliation prend effet à l'échéance et s'annule ; le retour de paiement
 * ne dépend pas du webhook.
 */
@Injectable()
export class FacturationService {
  private readonly logger = new Logger(FacturationService.name);
  private readonly env: Env = loadEnv();
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantPrismaService,
    private readonly modules: ModulesService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {
    this.stripe = this.env.STRIPE_SECRET_KEY
      ? new Stripe(this.env.STRIPE_SECRET_KEY, {
          apiVersion: VERSION_API_STRIPE as Stripe.LatestApiVersion,
        })
      : null;
  }

  /** La souscription est-elle ouverte ? Fermée par défaut, et sans clé. */
  get ouverte(): boolean {
    return !this.env.BILLING_DISABLED && this.stripe !== null;
  }

  private stripeOuvert(): Stripe {
    if (!this.ouverte || !this.stripe) throw new ServiceUnavailableException(FERMEE);
    return this.stripe;
  }

  /** Le portail et la synchronisation restent possibles même fermée. */
  private stripeConfigure(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'La facturation en ligne n’est pas branchée sur ce serveur.',
      );
    }
    return this.stripe;
  }

  private tarifs(): Promise<Tarif[]> {
    return this.prisma.tarifModule.findMany();
  }

  // ===================================================================
  //  Lecture
  // ===================================================================

  /**
   * Ce que la page des modules affiche : l'offre (modules vendables
   * seulement), l'état de chaque module, l'abonnement.
   */
  async offre(societeId: number) {
    const [etat, tarifs, abonnement] = await Promise.all([
      this.modules.etat(societeId),
      this.tarifs(),
      this.db.runInTenant(societeId, (tx) =>
        tx.abonnementSociete.findUnique({ where: { societeId } }),
      ),
    ]);
    const parModule = new Map(tarifs.map((t) => [t.module, t]));
    const souscriptions = await this.db.runInTenant(societeId, (tx) =>
      tx.souscriptionModule.findMany({
        where: { societeId },
        select: { module: true, stripeSubscriptionItemId: true },
      }),
    );
    const facture = new Set(
      souscriptions.filter((s) => s.stripeSubscriptionItemId).map((s) => s.module),
    );

    return {
      ouverte: this.ouverte,
      portail: this.stripe !== null && abonnement !== null,
      essaiPermis: essaiPermis(abonnement),
      dureeEssaiJours: DUREE_ESSAI_JOURS,
      abonnement: abonnement && {
        statut: abonnement.statut,
        vivant: abonnementVivant(abonnement.statut),
        finPeriode: abonnement.finPeriode,
        annulationFinPeriode: abonnement.annulationFinPeriode,
        essaiFinLe: abonnement.essaiFinLe,
      },
      modules: etat.modules.map((m) => {
        const tarif = parModule.get(m.code);
        return {
          ...m,
          // Un module sans prix complet ne se vend pas : on ne dit pas son
          // prix, et l'interface ne propose aucun bouton payant.
          vendable: tarifVendable(tarif),
          prixMensuel: tarifVendable(tarif) ? tarif.prixMensuel.toString() : null,
          factureParStripe: facture.has(m.code),
        };
      }),
    };
  }

  // ===================================================================
  //  Souscrire — la première fois, par Checkout
  // ===================================================================

  async demarrer(societeId: number, email: string, codes: string[]) {
    const stripe = this.stripeOuvert();
    const [etat, tarifs] = await Promise.all([this.offre(societeId), this.tarifs()]);
    if (etat.abonnement?.vivant) {
      // Le serveur refuse ce que l'interface ne propose plus : un second
      // abonnement laisserait le premier facturer, orphelin.
      throw new ConflictException(
        'Votre société a déjà un abonnement : ajoutez le module depuis cette page, sans repasser par le paiement initial.',
      );
    }
    const choisis = [...new Set(codes)];
    if (!choisis.length) throw new BadRequestException('Choisissez au moins un module.');
    const lignes = choisis.map((code) => {
      const m = etat.modules.find((x) => x.code === code);
      const tarif = tarifs.find((t) => t.module === code);
      if (!m || !tarifVendable(tarif)) {
        throw new BadRequestException(`« ${code} » ne se souscrit pas en ligne.`);
      }
      if (!m.eligible) {
        throw new BadRequestException(`« ${m.libelle} » ne s'adresse pas à votre profil.`);
      }
      if (m.statut === 'ACTIF' || m.statut === 'ESSAI') {
        throw new BadRequestException(`« ${m.libelle} » est déjà ouvert pour votre société.`);
      }
      return { price: tarif.stripePriceId, quantity: 1 };
    });

    const client = await this.clientStripe(stripe, societeId, email);
    const essai = etat.essaiPermis;
    const taux = this.env.STRIPE_TAX_RATE_ID ? [this.env.STRIPE_TAX_RATE_ID] : undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: client,
      client_reference_id: String(societeId),
      line_items: lignes.map((l) => ({ ...l, tax_rates: taux })),
      payment_method_collection: 'always',
      locale: 'fr',
      metadata: { societeId: String(societeId) },
      subscription_data: {
        metadata: { societeId: String(societeId) },
        ...(essai
          ? {
              trial_period_days: DUREE_ESSAI_JOURS,
              trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            }
          : {}),
      },
      success_url: `${this.env.PUBLIC_WEB_URL}/modules/resultat?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.env.PUBLIC_WEB_URL}/modules`,
    });

    await this.db.runInTenant(societeId, (tx) =>
      this.audit.enregistrerAutomatique(tx, societeId, {
        action: 'facturation.checkout',
        entite: 'AbonnementSociete',
        donnees: { modules: choisis, essai },
      }),
    );
    return { url: session.url };
  }

  /** Le client Stripe de la société — créé une fois, réutilisé ensuite. */
  private async clientStripe(stripe: Stripe, societeId: number, email: string): Promise<string> {
    const existant = await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.findUnique({ where: { societeId } }),
    );
    if (existant) return existant.stripeCustomerId;
    const societe = await this.db.runInTenant(societeId, (tx) =>
      tx.societe.findUniqueOrThrow({ where: { id: societeId }, select: { raisonSociale: true } }),
    );
    const client = await stripe.customers.create({
      name: societe.raisonSociale,
      email,
      metadata: { societeId: String(societeId) },
    });
    await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.create({ data: { societeId, stripeCustomerId: client.id } }),
    );
    return client.id;
  }

  /**
   * Le retour de Checkout. La page réconcilie elle-même — sans attendre le
   * webhook, qui peut arriver après, ou jamais.
   */
  async retour(societeId: number, sessionId: string) {
    const stripe = this.stripeConfigure();
    const abonnement = await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.findUnique({ where: { societeId } }),
    );
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['invoice'] });
    } catch {
      throw new NotFoundException('Session de paiement introuvable.');
    }
    // Un identifiant n'est pas une autorisation : la session doit être celle
    // du client Stripe de CETTE société.
    const client = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!abonnement || client !== abonnement.stripeCustomerId) {
      throw new NotFoundException('Session de paiement introuvable.');
    }
    if (session.status !== 'complete' || !session.subscription) {
      return { termine: false as const };
    }
    const idAbonnement =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const sub = await stripe.subscriptions.retrieve(idAbonnement);
    await this.synchroniser(societeId, sub);
    const facture = session.invoice && typeof session.invoice !== 'string' ? session.invoice : null;
    return {
      termine: true as const,
      ...(await this.resume(stripe, societeId, sub)),
      regleAujourdhui: session.amount_total ?? 0,
      recu: facture?.hosted_invoice_url ?? null,
    };
  }

  /** Ce que la société a obtenu, et ce qui suivra — pour l'écran de résultat. */
  private async resume(stripe: Stripe, societeId: number, sub: Stripe.Subscription) {
    const etat = lireAbonnement(sub, await this.tarifs());
    let prochainMontant: number | null = null;
    try {
      const apercu = await stripe.invoices.createPreview({
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscription: sub.id,
      });
      prochainMontant = apercu.amount_due;
    } catch {
      // Un abonnement annulé n'a pas de prochaine facture : rien à afficher.
    }
    void societeId;
    return {
      modules: etat.modules.map((m) => moduleCommercial(m.module)!.libelle),
      statut: etat.statut,
      essaiFinLe: sub.status === 'trialing' ? etat.essaiFinLe : null,
      finPeriode: etat.finPeriode,
      prochainMontant,
    };
  }

  // ===================================================================
  //  Ajouter un module à un abonnement vivant — aperçu, puis confirmation
  // ===================================================================

  private async contexteAbonnement(societeId: number) {
    const abonnement = await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.findUnique({ where: { societeId } }),
    );
    if (!abonnement?.stripeSubscriptionId || !abonnementVivant(abonnement.statut)) {
      throw new ConflictException(
        'Votre société n’a pas d’abonnement en cours : commencez par souscrire un module.',
      );
    }
    return abonnement as typeof abonnement & { stripeSubscriptionId: string };
  }

  private async moduleAjoutable(societeId: number, code: string) {
    const module = moduleCommercial(code);
    const tarif = (await this.tarifs()).find((t) => t.module === code);
    if (!module || !tarifVendable(tarif)) {
      throw new BadRequestException(`« ${code} » ne se souscrit pas en ligne.`);
    }
    const etat = await this.modules.etat(societeId);
    const m = etat.modules.find((x) => x.code === code)!;
    if (!m.eligible) {
      throw new BadRequestException(`« ${module.libelle} » ne s'adresse pas à votre profil.`);
    }
    const souscription = await this.db.runInTenant(societeId, (tx) =>
      tx.souscriptionModule.findUnique({
        where: { societeId_module: { societeId, module: code } },
      }),
    );
    // Un module résilié à l'échéance, pas encore échu : le reprendre ne coûte
    // rien, la période est déjà payée.
    const reprise =
      souscription?.finAcces != null &&
      souscription.finAcces > new Date() &&
      !souscription.stripeSubscriptionItemId;
    if (!reprise && (m.statut === 'ACTIF' || m.statut === 'ESSAI')) {
      throw new BadRequestException(`« ${module.libelle} » est déjà ouvert pour votre société.`);
    }
    return { module, tarif, reprise };
  }

  /**
   * L'aperçu : ce que coûte l'ajout aujourd'hui, et ce que coûtera chaque
   * mois ensuite. Deux montants, tous deux calculés par Stripe.
   */
  async apercuAjout(societeId: number, code: string) {
    const stripe = this.stripeOuvert();
    const abonnement = await this.contexteAbonnement(societeId);
    const { module, tarif, reprise } = await this.moduleAjoutable(societeId, code);
    const prorationDate = Math.floor(Date.now() / 1000);
    const taux = this.env.STRIPE_TAX_RATE_ID ? [this.env.STRIPE_TAX_RATE_ID] : undefined;
    const item = { price: tarif.stripePriceId, tax_rates: taux };

    const [aujourdhui, ensuite] = await Promise.all([
      stripe.invoices.createPreview({
        customer: abonnement.stripeCustomerId,
        subscription: abonnement.stripeSubscriptionId,
        subscription_details: {
          items: [item],
          proration_behavior: reprise ? 'none' : 'always_invoice',
          proration_date: prorationDate,
        },
      }),
      stripe.invoices.createPreview({
        customer: abonnement.stripeCustomerId,
        subscription: abonnement.stripeSubscriptionId,
        subscription_details: { items: [item], proration_behavior: 'none' },
      }),
    ]);

    return {
      module: module.code,
      libelle: module.libelle,
      // Pendant l'essai ou pour une reprise, rien n'est dû aujourd'hui.
      aujourdhui: reprise || abonnement.statut === 'trialing' ? 0 : aujourdhui.amount_due,
      ensuite: ensuite.amount_due,
      prochaineEcheance: abonnement.finPeriode,
      enEssai: abonnement.statut === 'trialing',
      reprise,
      prorationDate,
    };
  }

  async ajouter(societeId: number, code: string, prorationDate: number) {
    const stripe = this.stripeOuvert();
    if (!apercuValide(prorationDate)) {
      throw new ConflictException(
        'L’aperçu a plus de dix minutes : le montant a pu changer. Affichez-le à nouveau avant de confirmer.',
      );
    }
    const abonnement = await this.contexteAbonnement(societeId);
    const { tarif, reprise, module } = await this.moduleAjoutable(societeId, code);
    const taux = this.env.STRIPE_TAX_RATE_ID ? [this.env.STRIPE_TAX_RATE_ID] : undefined;

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.update(abonnement.stripeSubscriptionId, {
        items: [{ price: tarif.stripePriceId, tax_rates: taux }],
        proration_behavior: reprise ? 'none' : 'always_invoice',
        proration_date: prorationDate,
        // Carte refusée : Stripe lève, rien n'est ajouté, rien n'est ouvert.
        payment_behavior: 'error_if_incomplete',
        cancel_at_period_end: false,
        expand: ['latest_invoice'],
      });
    } catch (e) {
      if (e instanceof Stripe.errors.StripeCardError) {
        throw new HttpException(
          `Paiement refusé : « ${module.libelle} » n’est pas ajouté, rien n’a été prélevé. ${e.message}`,
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw e;
    }

    await this.synchroniser(societeId, sub);
    const facture =
      sub.latest_invoice && typeof sub.latest_invoice !== 'string' ? sub.latest_invoice : null;
    return {
      termine: true as const,
      ...(await this.resume(stripe, societeId, sub)),
      regleAujourdhui: reprise || sub.status === 'trialing' ? 0 : (facture?.amount_paid ?? 0),
      recu: reprise ? null : (facture?.hosted_invoice_url ?? null),
    };
  }

  // ===================================================================
  //  Résilier à l'échéance — et revenir sur sa décision
  // ===================================================================

  async resilier(societeId: number, code: string) {
    const stripe = this.stripeConfigure();
    const abonnement = await this.contexteAbonnement(societeId);
    const souscription = await this.db.runInTenant(societeId, (tx) =>
      tx.souscriptionModule.findUnique({
        where: { societeId_module: { societeId, module: code } },
      }),
    );
    if (!souscription?.stripeSubscriptionItemId) {
      throw new BadRequestException(
        'Ce module n’est pas facturé en ligne : écrivez-nous pour le résilier.',
      );
    }
    const sub = await stripe.subscriptions.retrieve(abonnement.stripeSubscriptionId);
    if (sub.items.data.length <= 1) {
      // Le dernier module : Stripe ne garde pas un abonnement vide, on
      // l'annule à l'échéance.
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    } else {
      // Retiré sans prorata ni remboursement : la période est payée, et le
      // module reste ouvert jusqu'à son terme.
      await stripe.subscriptionItems.del(souscription.stripeSubscriptionItemId, {
        proration_behavior: 'none',
      });
    }
    const frais = await stripe.subscriptions.retrieve(sub.id);
    await this.synchroniser(societeId, frais, { resilie: code, finAcces: this.finPeriode(sub) });
    return this.offre(societeId);
  }

  async reprendre(societeId: number, code: string) {
    const stripe = this.stripeConfigure();
    const abonnement = await this.contexteAbonnement(societeId);
    const sub = await stripe.subscriptions.retrieve(abonnement.stripeSubscriptionId);
    if (sub.cancel_at_period_end) {
      const frais = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
      await this.synchroniser(societeId, frais);
      return this.offre(societeId);
    }
    // Un module retiré de l'abonnement : le remettre, sans rien facturer.
    const { tarif, reprise } = await this.moduleAjoutable(societeId, code);
    if (!reprise) throw new BadRequestException('Aucune résiliation programmée à annuler.');
    const taux = this.env.STRIPE_TAX_RATE_ID ? [this.env.STRIPE_TAX_RATE_ID] : undefined;
    const frais = await stripe.subscriptions.update(sub.id, {
      items: [{ price: tarif.stripePriceId, tax_rates: taux }],
      proration_behavior: 'none',
    });
    await this.synchroniser(societeId, frais);
    return this.offre(societeId);
  }

  private finPeriode(sub: Stripe.Subscription): Date | null {
    if (sub.status === 'trialing' && sub.trial_end) return new Date(sub.trial_end * 1000);
    return lireAbonnement(sub, []).finPeriode;
  }

  /** Le portail Stripe : carte, factures. Ouvert même souscription fermée. */
  async portail(societeId: number) {
    const stripe = this.stripeConfigure();
    const abonnement = await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.findUnique({ where: { societeId } }),
    );
    if (!abonnement) throw new NotFoundException('Aucun abonnement en ligne pour votre société.');
    const session = await stripe.billingPortal.sessions.create({
      customer: abonnement.stripeCustomerId,
      return_url: `${this.env.PUBLIC_WEB_URL}/modules`,
      locale: 'fr',
    });
    return { url: session.url };
  }

  // ===================================================================
  //  Synchronisation — Stripe est la vérité du paiement
  // ===================================================================

  /**
   * Aligne la base sur un abonnement Stripe relu par le SDK.
   *
   * Idempotente : rejouée dix fois, elle écrit une fois. Chaque module passe
   * par `ModulesService.changer`, qui historise, audite et recalcule.
   */
  async synchroniser(
    societeId: number,
    sub: Stripe.Subscription,
    options: { resilie?: string; finAcces?: Date | null } = {},
  ): Promise<void> {
    const etat = lireAbonnement(sub, await this.tarifs());
    if (etat.inconnus.length) {
      this.logger.warn(
        `Société ${societeId} : abonnement ${sub.id} porte des prix sans module (${etat.inconnus.join(', ')}).`,
      );
    }

    const avant = await this.db.runInTenant(societeId, async (tx: TenantDb) => {
      const a = await tx.abonnementSociete.findUnique({ where: { societeId } });
      if (!a) throw new NotFoundException(`Aucun client Stripe pour la société ${societeId}.`);
      await tx.abonnementSociete.update({
        where: { societeId },
        data: {
          stripeSubscriptionId: sub.id,
          statut: etat.statut,
          finPeriode: etat.finPeriode,
          annulationFinPeriode: etat.annulationFinPeriode,
          essaiFinLe: essaiAEcrire(etat.essaiFinLe, a.essaiFinLe),
        },
      });
      const souscriptions = await tx.souscriptionModule.findMany({ where: { societeId } });
      return { abonnement: a, souscriptions };
    });

    const statut = statutModule(etat.statut);
    const maintenant = new Date();
    const finAccesGlobale =
      etat.annulationFinPeriode && statut !== 'RESILIE' ? this.finPeriode(sub) : null;

    for (const { module, itemId } of etat.modules) {
      if (statut === 'ESSAI' && (!etat.essaiFinLe || etat.essaiFinLe <= maintenant)) continue;
      await this.modules.changer(societeId, module, statut, {
        source: 'STRIPE',
        stripeSubscriptionItemId: statut === 'RESILIE' ? null : itemId,
        finEssai: statut === 'ESSAI' ? etat.essaiFinLe! : undefined,
        finAcces: finAccesGlobale,
        raison: finAccesGlobale
          ? `Abonnement annulé à l’échéance du ${finAccesGlobale.toISOString().slice(0, 10)}.`
          : undefined,
      });
    }

    // Les modules facturés par Stripe qui ne figurent plus dans l'abonnement.
    const presents = new Set(etat.modules.map((m) => m.module as string));
    for (const s of avant.souscriptions) {
      if (!s.stripeSubscriptionItemId || presents.has(s.module) || s.statut === 'RESILIE') {
        continue;
      }
      const finAcces = s.module === options.resilie ? (options.finAcces ?? null) : s.finAcces;
      if (finAcces && finAcces > maintenant && statut !== 'RESILIE') {
        // Résilié à l'échéance : ouvert jusqu'au bout de la période payée.
        await this.modules.changer(societeId, s.module, s.statut, {
          source: 'STRIPE',
          stripeSubscriptionItemId: null,
          finEssai: s.statut === 'ESSAI' ? (s.finEssai ?? undefined) : undefined,
          finAcces,
          raison: `Résiliation programmée au ${finAcces.toISOString().slice(0, 10)}.`,
        });
      } else {
        await this.modules.changer(societeId, s.module, 'RESILIE', {
          source: 'STRIPE',
          stripeSubscriptionItemId: null,
        });
      }
    }

    // E-mails : une fois par événement, jamais aux renouvellements.
    const ancien = avant.abonnement.statut;
    const libelles = etat.modules.map((m) => moduleCommercial(m.module)!.libelle);
    if (etat.statut === 'trialing' && ancien !== 'trialing' && etat.essaiFinLe) {
      await this.envoyerUneFois(societeId, 'essai-demarre', sub.id, async (societe) =>
        essaiDemarre({
          societe,
          modules: libelles,
          finEssai: etat.essaiFinLe!,
          montantEnsuite: await this.prochainMontant(sub),
        }),
      );
    }
    if (etat.statut === 'active' && ancien !== 'active' && ancien !== 'past_due') {
      await this.envoyerUneFois(societeId, 'abonnement-confirme', sub.id, async (societe) =>
        abonnementConfirme({ societe, modules: libelles, finPeriode: etat.finPeriode }),
      );
    }
  }

  private async prochainMontant(sub: Stripe.Subscription): Promise<number | null> {
    if (!this.stripe) return null;
    try {
      const apercu = await this.stripe.invoices.createPreview({
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscription: sub.id,
      });
      return apercu.amount_due;
    } catch {
      return null;
    }
  }

  // ===================================================================
  //  Webhook
  // ===================================================================

  async recevoirWebhook(corpsBrut: Buffer | undefined, signature: string | undefined) {
    const stripe = this.stripeConfigure();
    if (!this.env.STRIPE_WEBHOOK_SECRET) {
      throw new ServiceUnavailableException('Webhook Stripe non configuré.');
    }
    if (!corpsBrut || !signature) throw new BadRequestException('Signature Stripe absente.');
    let evenement: Stripe.Event;
    try {
      evenement = stripe.webhooks.constructEvent(
        corpsBrut,
        signature,
        this.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new BadRequestException('Signature Stripe invalide.');
    }

    const deja = await this.prisma.evenementStripe.findUnique({ where: { id: evenement.id } });
    if (deja?.traiteLe) return { recu: true, doublon: true };
    if (!deja) {
      await this.prisma.evenementStripe
        .create({ data: { id: evenement.id, type: evenement.type } })
        .catch(() => undefined); // livré deux fois en même temps : l'autre l'a inscrit
    }

    try {
      const societeId = await this.traiter(stripe, evenement);
      await this.prisma.evenementStripe.update({
        where: { id: evenement.id },
        data: { traiteLe: new Date(), societeId, erreur: null },
      });
      return { recu: true };
    } catch (e) {
      await this.prisma.evenementStripe.update({
        where: { id: evenement.id },
        data: { erreur: (e as Error).message.slice(0, 500) },
      });
      // 500 : Stripe réessaiera. Un événement avalé serait un paiement perdu.
      throw e;
    }
  }

  private async traiter(stripe: Stripe, evenement: Stripe.Event): Promise<number | null> {
    const objet = evenement.data.object as { customer?: string | { id: string } | null };
    const client = typeof objet.customer === 'string' ? objet.customer : objet.customer?.id;
    if (!client) return null;
    const societeId = await this.societeDuClient(client);
    if (!societeId) {
      this.logger.warn(`Événement ${evenement.id} : client Stripe ${client} inconnu.`);
      return null;
    }

    // On relit l'abonnement par le SDK épinglé plutôt que de croire
    // `event.data.object` : les versions récentes en ont retiré des champs.
    const idAbonnement = this.abonnementDe(evenement);
    if (!idAbonnement) return societeId;
    const sub = await stripe.subscriptions.retrieve(idAbonnement);
    await this.synchroniser(societeId, sub);
    if (evenement.type === 'customer.subscription.trial_will_end') {
      await this.avertirFinEssai(societeId);
    }
    return societeId;
  }

  private abonnementDe(evenement: Stripe.Event): string | null {
    const o = evenement.data.object as unknown as Record<string, unknown>;
    switch (evenement.type) {
      case 'checkout.session.completed':
        return typeof o.subscription === 'string' ? o.subscription : null;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        return typeof o.id === 'string' ? o.id : null;
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const parent = o.parent as
          { subscription_details?: { subscription?: string | { id: string } } } | undefined;
        const s = parent?.subscription_details?.subscription;
        return typeof s === 'string' ? s : (s?.id ?? null);
      }
      default:
        return null;
    }
  }

  private async societeDuClient(client: string): Promise<number | null> {
    const lignes = await this.prisma.$queryRaw<{ id: number | null }[]>`
      SELECT app.societe_pour_client_stripe(${client}) AS id`;
    return lignes[0]?.id ?? null;
  }

  // ===================================================================
  //  Avertissement J-3 — deux chemins, même clé
  // ===================================================================

  /**
   * Le webhook `trial_will_end` ET la passe quotidienne appellent ceci, avec
   * la même clé d'idempotence : jamais deux envois. Aucun des deux n'est « le
   * filet » de l'autre — chacun peut mourir sans bruit.
   */
  async avertirFinEssai(societeId: number): Promise<boolean> {
    const abonnement = await this.db.runInTenant(societeId, (tx) =>
      tx.abonnementSociete.findUnique({ where: { societeId } }),
    );
    if (!abonnement?.essaiFinLe || abonnement.statut !== 'trialing') return false;
    const finEssai = abonnement.essaiFinLe;
    let montant: number | null = null;
    if (this.stripe && abonnement.stripeSubscriptionId) {
      try {
        const apercu = await this.stripe.invoices.createPreview({
          customer: abonnement.stripeCustomerId,
          subscription: abonnement.stripeSubscriptionId,
        });
        montant = apercu.amount_due;
      } catch {
        montant = null;
      }
    }
    return this.envoyerUneFois(
      societeId,
      'fin-essai',
      finEssai.toISOString().slice(0, 10),
      async (societe) =>
        finEssaiProche({ societe, finEssai, montant, annule: abonnement.annulationFinPeriode }),
    );
  }

  /** Pour la passe quotidienne : les essais qui finissent dans trois jours. */
  async avertirFinsEssai(): Promise<number> {
    const essais = await this.prisma.$queryRaw<{ societe_id: number }[]>`
      SELECT societe_id FROM app.essais_a_prevenir(${new Date(Date.now() + AVANCE_AVERTISSEMENT_MS)}::timestamp)`;
    let envoyes = 0;
    for (const { societe_id } of essais) {
      if (await this.avertirFinEssai(societe_id)) envoyes++;
    }
    return envoyes;
  }

  /**
   * Envoie un e-mail de facturation aux administrateurs de la société, une
   * seule fois par (clé, référence). La ligne d'idempotence et l'envoi sont
   * dans la même transaction : un envoi qui échoue ne laisse pas de trace
   * qui bloquerait le suivant.
   */
  private async envoyerUneFois(
    societeId: number,
    cle: string,
    reference: string,
    rediger: (societe: string) => Promise<Courriel>,
  ): Promise<boolean> {
    return this.db.runInTenant(societeId, async (tx) => {
      const deja = await tx.emailFacturation.findUnique({
        where: { societeId_cle_reference: { societeId, cle, reference } },
      });
      if (deja) return false;
      await tx.emailFacturation.create({ data: { societeId, cle, reference } });
      const [societe, admins] = await Promise.all([
        tx.societe.findUniqueOrThrow({
          where: { id: societeId },
          select: { raisonSociale: true },
        }),
        tx.membership.findMany({
          where: { societeId, role: { in: ['OWNER', 'ADMIN'] } },
          select: { compte: { select: { email: true, isActive: true } } },
        }),
      ]);
      const destinataires = admins.filter((a) => a.compte.isActive).map((a) => a.compte.email);
      if (!destinataires.length) return false;
      const courriel = await rediger(societe.raisonSociale);
      await this.mail.envoyer({ to: destinataires, ...courriel });
      return true;
    });
  }

  // ===================================================================
  //  Exploitant — les prix
  // ===================================================================

  async tarifsPourExploitant() {
    const tarifs = await this.tarifs();
    return {
      ouverte: this.ouverte,
      stripeBranche: this.stripe !== null,
      webhookBranche: Boolean(this.env.STRIPE_WEBHOOK_SECRET),
      tvaBranchee: Boolean(this.env.STRIPE_TAX_RATE_ID),
      evenementsTraites: EVENEMENTS_TRAITES,
      derniereTrace: await this.prisma.passeQuotidienne.findFirst({ orderBy: { id: 'desc' } }),
      modules: CATALOGUE.map((m) => {
        const t = tarifs.find((x) => x.module === m.code);
        return {
          code: m.code,
          libelle: m.libelle,
          prixMensuel: t?.prixMensuel.toString() ?? null,
          stripePriceId: t?.stripePriceId ?? null,
          vendable: tarifVendable(t),
        };
      }),
    };
  }

  /**
   * Saisir un prix. Si Stripe est branché, le prix Stripe est relu : un
   * montant qui ne correspond pas à celui affiché est refusé — prix affiché =
   * prix facturé.
   */
  async fixerTarif(code: string, prixMensuel: string, stripePriceId: string | null) {
    const module = moduleCommercial(code);
    if (!module) throw new NotFoundException(`Module « ${code} » inconnu.`);
    if (stripePriceId && this.stripe) {
      let prix: Stripe.Price;
      try {
        prix = await this.stripe.prices.retrieve(stripePriceId);
      } catch {
        throw new BadRequestException(`Prix Stripe « ${stripePriceId} » introuvable.`);
      }
      const centimes = Math.round(Number(prixMensuel) * 100);
      if (
        prix.currency !== 'chf' ||
        prix.unit_amount !== centimes ||
        prix.recurring?.interval !== 'month' ||
        !prix.active
      ) {
        throw new BadRequestException(
          `Le prix Stripe ne correspond pas : attendu CHF ${prixMensuel} par mois, actif. ` +
            `Stripe annonce ${prix.currency.toUpperCase()} ${((prix.unit_amount ?? 0) / 100).toFixed(2)}` +
            ` par ${prix.recurring?.interval ?? 'paiement unique'}${prix.active ? '' : ', inactif'}.`,
        );
      }
    }
    return this.prisma.tarifModule.upsert({
      where: { module: code },
      create: { module: code, prixMensuel, stripePriceId },
      update: { prixMensuel, stripePriceId },
    });
  }
}
