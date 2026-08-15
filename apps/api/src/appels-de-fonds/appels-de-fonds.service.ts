import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PasserelleService } from '../passerelle/passerelle.service';
import { GedService } from '../ged/ged.service';
import { QrFactureService } from './qr-facture.pdf';
import { calculerMontantAppel, etatAppel, numeroAppel, STATUTS_ENGAGES } from './calculs';
import { formaterReferenceQR, genererReferenceQR } from './qr-reference';

const ZERO = new Prisma.Decimal(0);

/** Délai de paiement par défaut d'un appel de fonds, en jours. */
const DELAI_PAIEMENT_JOURS = 30;

export interface ResultatDeclenchement {
  etape: { id: number; libelle: string; pourcentage: string | null };
  jalonDeSuivi: boolean;
  appelsCrees: number;
  appelsDejaExistants: number;
  montantTotal: string;
  envois: { reussis: number; echecs: { appelId: number; raison: string }[] };
  /** Résultat de la poussée vers Kolabimo. Un échec laisse l'événement rejouable. */
  synchronisation: { livre: boolean; raison?: string };
}

@Injectable()
export class AppelsDeFondsService {
  private readonly logger = new Logger(AppelsDeFondsService.name);

  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly passerelle: PasserelleService,
    private readonly qrFacture: QrFactureService,
    private readonly ged: GedService,
  ) {}

  // ===================================================================
  //  Le moteur
  // ===================================================================

  /**
   * Marque un jalon terminé et en tire les appels de fonds.
   *
   * C'est **le** geste métier du produit côté vente. Trois propriétés le
   * gouvernent :
   *
   *   1. **Idempotence.** L'unicité `(reservationId, etapeId)` est en base ;
   *      rejouer un déclenchement ne crée rien de nouveau. Un promoteur qui
   *      reclique, ou un webhook rejoué, ne facture pas deux fois.
   *   2. **Un jalon sans pourcentage n'appelle rien.** C'est un suivi de
   *      chantier, pas une échéance de paiement.
   *   3. **Les e-mails partent après le commit.** Envoyer dans la transaction
   *      enverrait des appels de fonds pour des lignes qu'un échec ultérieur
   *      annulerait — et un e-mail parti ne se rattrape pas.
   */
  async declencherEtape(
    operationId: number,
    etapeId: number,
    options: { dateCompletion?: Date; envoyer?: boolean } = {},
  ): Promise<ResultatDeclenchement> {
    const dateCompletion = options.dateCompletion ?? new Date();
    const envoyer = options.envoyer ?? true;

    const societeId = RequestContext.requireSocieteId();

    const { etape, crees, dejaExistants, montantTotal, evenementSortant } = await this.db.run(
      async (tx) => {
        const etape = await tx.echeancierEtape.findFirst({
          where: { id: etapeId, operationId },
          select: {
            id: true,
            libelle: true,
            pourcentage: true,
            statut: true,
            ordre: true,
            kolabimoEtapeId: true,
          },
        });
        if (!etape)
          throw new NotFoundException(`Étape ${etapeId} introuvable dans cette opération.`);

        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: operationId },
          select: { kolabimoPromotionId: true },
        });

        await tx.echeancierEtape.update({
          where: { id: etapeId },
          data: { statut: 'COMPLETED', dateCompletion },
        });

        if (etape.pourcentage === null) {
          await this.audit.enregistrer(tx, {
            action: 'echeancier_etape.completee',
            entite: 'EcheancierEtape',
            entiteId: etapeId,
            donnees: { operationId, libelle: etape.libelle, appelsDeFonds: 0, jalonDeSuivi: true },
          });
          // Un jalon de suivi n'appelle rien, mais Kolabimo doit quand même
          // savoir que l'étape est faite : c'est de l'avancement de chantier.
          const evenementSortant = await this.deposerJalon(tx, {
            societeId,
            operationId,
            promotionId: operation.kolabimoPromotionId,
            etape,
            dateCompletion,
            appels: [],
          });
          return { etape, crees: [], dejaExistants: 0, montantTotal: ZERO, evenementSortant };
        }

        const reservations = await tx.reservation.findMany({
          where: { operationId, statut: { in: STATUTS_ENGAGES } },
          include: {
            lot: { select: { reference: true } },
            acquereur: {
              select: { id: true, nom: true, prenom: true, email: true, adresse: true },
            },
          },
        });

        const existants = await tx.appelDeFonds.findMany({
          where: { etapeId },
          select: { reservationId: true },
        });
        const dejaAppelees = new Set(existants.map((a) => a.reservationId));

        const crees: {
          id: number;
          reservationId: number;
          montant: Prisma.Decimal;
          lot: string;
          acquereurNom: string;
          acquereurEmail: string | null;
          acquereurAdresse: string | null;
          qrReference: string;
          dateEcheance: Date;
        }[] = [];
        let montantTotal = ZERO;

        const dateEcheance = new Date(dateCompletion);
        dateEcheance.setDate(dateEcheance.getDate() + DELAI_PAIEMENT_JOURS);

        for (const reservation of reservations) {
          if (dejaAppelees.has(reservation.id)) continue;
          if (!reservation.prixTotalActe) {
            // Sans assiette, on ne devine pas : mieux vaut sauter et le dire
            // que d'émettre un appel à zéro qui passerait inaperçu.
            this.logger.warn(
              `Réservation ${reservation.id} sans prix total acte : aucun appel de fonds généré.`,
            );
            continue;
          }

          const montant = calculerMontantAppel(etape.pourcentage, reservation.prixTotalActe);
          const qrReference = genererReferenceQR(operationId, reservation.id, etapeId);

          const appel = await tx.appelDeFonds.create({
            data: {
              reservationId: reservation.id,
              etapeId,
              pourcentage: etape.pourcentage,
              montant,
              statut: 'EMIS',
              dateEmission: dateCompletion,
              dateEcheance,
              qrReference,
            },
          });

          // Le numéro dérive de l'identifiant : lisible, unique, et stable.
          const numero = numeroAppel(dateCompletion.getFullYear(), appel.id);
          await tx.appelDeFonds.update({ where: { id: appel.id }, data: { numero } });

          montantTotal = montantTotal.plus(montant);
          crees.push({
            id: appel.id,
            reservationId: reservation.id,
            montant,
            lot: reservation.lot.reference,
            acquereurNom:
              `${reservation.acquereur.prenom ?? ''} ${reservation.acquereur.nom ?? ''}`.trim(),
            acquereurEmail: reservation.acquereur.email,
            acquereurAdresse: reservation.acquereur.adresse,
            qrReference,
            dateEcheance,
          });
        }

        await this.audit.enregistrer(tx, {
          action: 'echeancier_etape.completee',
          entite: 'EcheancierEtape',
          entiteId: etapeId,
          donnees: {
            operationId,
            libelle: etape.libelle,
            pourcentage: etape.pourcentage,
            appelsCrees: crees.length,
            appelsDejaExistants: dejaAppelees.size,
            montantTotal,
          },
        });

        const evenementSortant = await this.deposerJalon(tx, {
          societeId,
          operationId,
          promotionId: operation.kolabimoPromotionId,
          etape,
          dateCompletion,
          appels: crees,
        });

        return { etape, crees, dejaExistants: dejaAppelees.size, montantTotal, evenementSortant };
      },
    );

    // La livraison à Kolabimo se fait hors transaction, et son échec ne remet
    // rien en cause : l'événement reste en boîte d'envoi, rejouable depuis le
    // journal. Kolabimo indisponible n'empêche pas de clore un jalon.
    const synchronisation = await this.passerelle.livrer(evenementSortant);
    if (synchronisation.livre) {
      await this.db.run((tx) =>
        tx.echeancierEtape.update({ where: { id: etapeId }, data: { syncedAt: new Date() } }),
      );
    }

    // --- Après le commit seulement -------------------------------------
    const echecs: { appelId: number; raison: string }[] = [];
    let reussis = 0;

    if (envoyer) {
      const societe = await this.db.run((tx) =>
        tx.societe.findUniqueOrThrow({
          where: { id: RequestContext.requireSocieteId() },
          select: {
            raisonSociale: true,
            iban: true,
            adresse: true,
            codePostal: true,
            localite: true,
          },
        }),
      );

      for (const appel of crees) {
        if (!appel.acquereurEmail) {
          echecs.push({ appelId: appel.id, raison: 'Acquéreur sans adresse e-mail' });
          continue;
        }

        const numero = numeroAppel(dateCompletion.getFullYear(), appel.id);

        // La QR-facture est produite AVANT l'envoi, et son absence n'empêche
        // pas le message de partir : un acquéreur informé sans pièce jointe
        // reste mieux servi qu'un acquéreur non informé.
        const facture = await this.produireQrFacture(
          operationId,
          appel,
          numero,
          etape.libelle,
          societe,
        );

        try {
          await this.mail.envoyer({
            to: appel.acquereurEmail,
            subject: `Appel de fonds ${numero} — lot ${appel.lot}`,
            text: this.corpsAppel(appel, etape.libelle, societe, facture !== null),
            pieces: facture
              ? [
                  {
                    nom: `${numero}-${appel.lot}.pdf`,
                    contenu: facture,
                    typeMime: 'application/pdf',
                  },
                ]
              : undefined,
          });
          await this.db.run((tx) =>
            tx.appelDeFonds.update({
              where: { id: appel.id },
              data: { statut: 'ENVOYE', dateEnvoi: new Date() },
            }),
          );
          reussis += 1;
        } catch (erreur) {
          // L'appel existe et reste dû : un échec d'envoi ne l'annule pas.
          const raison = erreur instanceof Error ? erreur.message : 'Envoi impossible';
          this.logger.error(`Appel de fonds ${appel.id} non envoyé : ${raison}`);
          echecs.push({ appelId: appel.id, raison });
        }
      }
    }

    return {
      etape: {
        id: etape.id,
        libelle: etape.libelle,
        pourcentage: etape.pourcentage?.toString() ?? null,
      },
      jalonDeSuivi: etape.pourcentage === null,
      appelsCrees: crees.length,
      appelsDejaExistants: dejaExistants,
      montantTotal: montantTotal.toFixed(2),
      envois: { reussis, echecs },
      synchronisation,
    };
  }

  /**
   * Dépose l'événement `echeancier.etape_completed` en boîte d'envoi, dans la
   * transaction qui clôt le jalon.
   *
   * La clé de dédoublonnage est `(opération, étape)` : rejouer le même
   * déclenchement ne produit pas un second message. C'est la même propriété
   * que celle qui empêche un second appel de fonds, appliquée au fil sortant.
   */
  private async deposerJalon(
    tx: TenantDb,
    contexte: {
      societeId: number;
      operationId: number;
      promotionId: number | null;
      etape: { id: number; libelle: string; ordre: number; pourcentage: Prisma.Decimal | null };
      dateCompletion: Date;
      appels: {
        reservationId: number;
        montant: Prisma.Decimal;
        lot: string;
        qrReference: string;
        dateEcheance: Date;
      }[];
    },
  ): Promise<number> {
    const externalIds = await tx.reservation.findMany({
      where: { id: { in: contexte.appels.map((a) => a.reservationId) } },
      select: { id: true, externalId: true },
    });
    const parReservation = new Map(externalIds.map((r) => [r.id, r.externalId]));

    return this.passerelle.deposerSortant(tx, {
      evenement: 'echeancier.etape_completed',
      cle: `${contexte.operationId}-${contexte.etape.id}`,
      societeId: contexte.societeId,
      donnees: {
        promotionId: contexte.promotionId,
        operationId: contexte.operationId,
        etape: {
          ordre: contexte.etape.ordre,
          libelle: contexte.etape.libelle,
          pourcentage: contexte.etape.pourcentage?.toString() ?? null,
          dateCompletion: contexte.dateCompletion.toISOString(),
        },
        appelsDeFonds: contexte.appels.map((a) => ({
          // `externalId` plutôt que notre id : c'est la clé que Kolabimo
          // reconnaît, et il n'a rien à savoir de nos identifiants internes.
          reservationExternalId: parReservation.get(a.reservationId) ?? null,
          lot: a.lot,
          montant: a.montant.toFixed(2),
          dateEcheance: a.dateEcheance.toISOString(),
          referenceQR: a.qrReference,
        })),
      },
    });
  }

  /**
   * Produit la QR-facture et la dépose en GED.
   *
   * Elle est **archivée** en même temps qu'envoyée : un acquéreur qui perd le
   * message doit pouvoir se la faire renvoyer telle quelle, et le promoteur
   * doit pouvoir montrer ce qui est parti.
   *
   * Rien ici ne fait échouer l'appel de fonds : la créance existe déjà en
   * base, une pièce jointe manquante ne la remet pas en cause.
   */
  private async produireQrFacture(
    operationId: number,
    appel: {
      id: number;
      montant: Prisma.Decimal;
      lot: string;
      acquereurNom: string;
      acquereurAdresse: string | null;
      qrReference: string;
      dateEcheance: Date;
    },
    numero: string,
    etapeLibelle: string,
    societe: {
      raisonSociale: string;
      iban: string | null;
      adresse: string | null;
      codePostal: string | null;
      localite: string | null;
    },
  ): Promise<Buffer | null> {
    try {
      const resultat = await this.qrFacture.generer({
        montant: Number(appel.montant.toFixed(2)),
        numero,
        referenceQR: appel.qrReference,
        lot: appel.lot,
        etapeLibelle,
        dateEcheance: appel.dateEcheance,
        societe,
        acquereur: { nom: appel.acquereurNom, adresse: appel.acquereurAdresse },
      });
      if (!resultat) return null;

      if (resultat.reference.type === 'AUCUNE') {
        // Le promoteur doit le savoir : sans référence structurée, le
        // rapprochement bancaire redevient manuel.
        this.logger.warn(`QR-facture ${numero} sans référence — ${resultat.reference.raison}`);
      }

      await this.ged.deposer(
        operationId,
        {
          nomOriginal: `${numero}-${appel.lot}.pdf`,
          mimeType: 'application/pdf',
          contenu: resultat.pdf,
        },
        { titre: `QR-facture ${numero} — lot ${appel.lot}`, categorie: 'FACTURE' },
      );

      return resultat.pdf;
    } catch (erreur) {
      this.logger.error(
        `QR-facture ${numero} non produite : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
      return null;
    }
  }

  private corpsAppel(
    appel: {
      montant: Prisma.Decimal;
      lot: string;
      acquereurNom: string;
      qrReference: string;
      dateEcheance: Date;
    },
    etapeLibelle: string,
    societe: {
      raisonSociale: string;
      iban: string | null;
      adresse: string | null;
      codePostal: string | null;
      localite: string | null;
    },
    avecFacture: boolean,
  ): string {
    // `null` = ligne absente ; `''` = ligne vide voulue. Filtrer les chaînes
    // vides écraserait la mise en page du message.
    const lignes: (string | null)[] = [
      `Madame, Monsieur ${appel.acquereurNom},`,
      '',
      `L'étape « ${etapeLibelle} » de votre promotion est achevée. Conformément à`,
      `l'échéancier de votre acte, nous vous prions de bien vouloir verser :`,
      '',
      `    Montant   : ${appel.montant.toFixed(2)} CHF`,
      `    Lot       : ${appel.lot}`,
      `    Échéance  : ${appel.dateEcheance.toLocaleDateString('fr-CH')}`,
      `    Référence : ${formaterReferenceQR(appel.qrReference)}`,
      societe.iban ? `    IBAN      : ${societe.iban}` : null,
      '',
      'Merci de rappeler la référence ci-dessus lors de votre versement : elle',
      "permet d'affecter automatiquement le paiement à votre lot.",
      '',
      societe.raisonSociale,
      [societe.adresse, [societe.codePostal, societe.localite].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' — ') || null,
      '',
      avecFacture
        ? 'La QR-facture est jointe à ce message : elle peut être scannée depuis'
        : 'La QR-facture n’a pas pu être établie — les coordonnées de paiement',
      avecFacture
        ? "l'application bancaire, ou imprimée pour un versement au guichet."
        : 'ci-dessus font foi.',
    ];

    return lignes.filter((l): l is string => l !== null).join('\n');
  }

  // ===================================================================
  //  Consultation et suivi
  // ===================================================================

  async lister(operationId: number, options: { enRetard?: boolean } = {}) {
    const maintenant = new Date();

    const appels = await this.db.run((tx) =>
      tx.appelDeFonds.findMany({
        where: { reservation: { operationId } },
        include: {
          reservation: {
            select: {
              id: true,
              lot: { select: { reference: true } },
              acquereur: { select: { nom: true, prenom: true, email: true } },
            },
          },
          etape: { select: { id: true, ordre: true, libelle: true } },
          encaissements: {
            select: { id: true, montant: true, dateValeur: true, source: true },
            orderBy: { dateValeur: 'asc' },
          },
        },
        orderBy: [{ etape: { ordre: 'asc' } }, { id: 'asc' }],
      }),
    );

    const enrichis = appels.map((a) => ({
      ...a,
      etat: etatAppel(
        a.montant,
        a.encaissements.map((e) => e.montant),
        a.dateEcheance,
        maintenant,
      ),
    }));

    return options.enRetard ? enrichis.filter((a) => a.etat.enRetard) : enrichis;
  }

  /**
   * Enregistre un encaissement et met le statut à jour.
   *
   * `source` distingue une saisie manuelle d'un rapprochement camt.054 : le
   * jour où la passerelle bancaire arrive, on veut savoir ce qui a été
   * rapproché automatiquement et ce qui a été pointé à la main.
   */
  async enregistrerEncaissement(
    operationId: number,
    appelId: number,
    donnees: {
      montant: Prisma.Decimal;
      dateValeur: Date;
      reference?: string | null;
      source?: string | null;
    },
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;
    const societeId = RequestContext.requireSocieteId();

    const { encaissement, etat, evenementSortant } = await this.db.run(async (tx) => {
      const appel = await tx.appelDeFonds.findFirst({
        where: { id: appelId, reservation: { operationId } },
        include: {
          encaissements: { select: { montant: true } },
          reservation: {
            select: { externalId: true, lot: { select: { reference: true } } },
          },
        },
      });
      if (!appel) throw new NotFoundException(`Appel de fonds ${appelId} introuvable.`);
      if (appel.statut === 'ANNULE') {
        throw new BadRequestException(
          "Cet appel de fonds est annulé : il n'attend aucun paiement.",
        );
      }

      const encaissement = await tx.encaissement.create({
        data: {
          appelDeFondsId: appelId,
          ...donnees,
          source: donnees.source ?? 'saisie',
          confirmeParId: membershipId,
          dateConfirmation: new Date(),
        },
      });

      const etat = etatAppel(
        appel.montant,
        [...appel.encaissements.map((e) => e.montant), donnees.montant],
        appel.dateEcheance,
        new Date(),
      );

      await tx.appelDeFonds.update({
        where: { id: appelId },
        data: { statut: etat.soldé ? 'PAYE' : 'PARTIELLEMENT_PAYE' },
      });

      await this.audit.enregistrer(tx, {
        action: 'appel_de_fonds.encaissement',
        entite: 'Encaissement',
        entiteId: encaissement.id,
        donnees: {
          operationId,
          appelId,
          lot: appel.reservation.lot.reference,
          montant: donnees.montant,
          cumul: etat.montantEncaisse,
          solde: etat.solde,
          source: donnees.source ?? 'saisie',
        },
      });

      // Kolabimo tient une trésorerie ; c'est nous qui savons ce qui est
      // encaissé. On le lui dit, sans jamais lui demander la permission.
      const evenementSortant = await this.passerelle.deposerSortant(tx, {
        evenement: 'encaissement.enregistre',
        cle: String(encaissement.id),
        societeId,
        donnees: {
          operationId,
          reservationExternalId: appel.reservation.externalId,
          lot: appel.reservation.lot.reference,
          appelNumero: appel.numero,
          montant: donnees.montant.toFixed(2),
          dateValeur: donnees.dateValeur.toISOString(),
          cumulEncaisse: etat.montantEncaisse.toFixed(2),
          solde: etat.solde.toFixed(2),
          integralementPaye: etat.soldé,
          source: donnees.source ?? 'saisie',
        },
      });

      return { encaissement, etat, evenementSortant };
    });

    const synchronisation = await this.passerelle.livrer(evenementSortant);
    return { encaissement, etat, synchronisation };
  }

  /** Relance d'un appel échu et non soldé. */
  async relancer(operationId: number, appelId: number) {
    const appel = await this.db.run((tx) =>
      tx.appelDeFonds.findFirst({
        where: { id: appelId, reservation: { operationId } },
        include: {
          encaissements: { select: { montant: true } },
          etape: { select: { libelle: true } },
          reservation: {
            select: {
              lot: { select: { reference: true } },
              acquereur: { select: { nom: true, prenom: true, email: true } },
            },
          },
        },
      }),
    );
    if (!appel) throw new NotFoundException(`Appel de fonds ${appelId} introuvable.`);

    const etat = etatAppel(
      appel.montant,
      appel.encaissements.map((e) => e.montant),
      appel.dateEcheance,
      new Date(),
    );
    if (etat.soldé) {
      throw new BadRequestException('Cet appel de fonds est soldé : rien à relancer.');
    }
    if (!appel.reservation.acquereur.email) {
      throw new BadRequestException("L'acquéreur n'a pas d'adresse e-mail.");
    }

    const nom =
      `${appel.reservation.acquereur.prenom ?? ''} ${appel.reservation.acquereur.nom ?? ''}`.trim();

    const resultat = await this.mail.envoyer({
      to: appel.reservation.acquereur.email,
      subject: `Rappel — appel de fonds ${appel.numero ?? appel.id}, lot ${appel.reservation.lot.reference}`,
      text: [
        `Madame, Monsieur ${nom},`,
        '',
        `Sauf erreur de notre part, l'appel de fonds ${appel.numero ?? ''} reste ouvert.`,
        '',
        `    Montant appelé  : ${appel.montant.toFixed(2)} CHF`,
        `    Déjà versé      : ${etat.montantEncaisse.toFixed(2)} CHF`,
        `    Solde dû        : ${etat.solde.toFixed(2)} CHF`,
        appel.dateEcheance
          ? `    Échéance        : ${appel.dateEcheance.toLocaleDateString('fr-CH')}`
          : null,
        appel.qrReference
          ? `    Référence       : ${formaterReferenceQR(appel.qrReference)}`
          : null,
        '',
        'Si votre versement a été effectué entre-temps, merci de ne pas tenir compte',
        'de ce rappel.',
        // `null` = ligne absente ; `''` = ligne vide voulue.
      ]
        .filter((l): l is string => l !== null)
        .join('\n'),
    });

    await this.db.run(async (tx) => {
      if (etat.enRetard) {
        await tx.appelDeFonds.update({ where: { id: appelId }, data: { statut: 'EN_RETARD' } });
      }
      await this.audit.enregistrer(tx, {
        action: 'appel_de_fonds.relance',
        entite: 'AppelDeFonds',
        entiteId: appelId,
        donnees: { operationId, solde: etat.solde, destinataire: resultat.destinatairePrevu },
      });
    });

    return { relance: true, solde: etat.solde.toFixed(2), envoi: resultat };
  }
}
