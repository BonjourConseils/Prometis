import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { consolider, type Mouvement } from './consolidation';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class TresorerieService {
  constructor(private readonly db: TenantPrismaService) {}

  /**
   * Trésorerie d'une opération : ce qui est entré, ce qui est sorti, ce qui
   * reste attendu.
   *
   * Deux sources, et deux seulement — les **règlements réellement passés** :
   *   · `Encaissement` — versements des acquéreurs sur les appels de fonds ;
   *   · `PaiementFournisseur` — règlements des factures.
   *
   * Ce qui est facturé mais impayé n'entre pas dans la position : c'est un
   * engagement, pas de la trésorerie. Il est rendu à part, sous « attendu »,
   * parce que c'est justement ce qui permet de projeter le mois suivant.
   */
  async situation(operationId: number) {
    const { encaissements, paiements, creances, engagements } = await this.db.run(async (tx) => {
      const [encaissements, paiements, appelsOuverts, contrats, facturesValidees] =
        await Promise.all([
          tx.encaissement.findMany({
            where: { appelDeFonds: { reservation: { operationId } } },
            select: {
              montant: true,
              dateValeur: true,
              appelDeFonds: {
                select: {
                  numero: true,
                  reservation: { select: { lot: { select: { reference: true } } } },
                },
              },
            },
          }),
          tx.paiementFournisseur.findMany({
            where: { facture: { operationId } },
            select: {
              montant: true,
              dateValeur: true,
              facture: {
                select: {
                  numero: true,
                  // Le fournisseur vient de l'entreprise adjudicataire : la
                  // facture ne porte pas son nom en clair.
                  entreprise: { select: { nom: true } },
                },
              },
            },
          }),
          tx.appelDeFonds.findMany({
            where: {
              reservation: { operationId },
              statut: { in: ['EMIS', 'ENVOYE', 'PARTIELLEMENT_PAYE', 'EN_RETARD'] },
            },
            select: {
              id: true,
              numero: true,
              montant: true,
              dateEcheance: true,
              encaissements: { select: { montant: true } },
              reservation: { select: { lot: { select: { reference: true } } } },
            },
          }),
          tx.contrat.findMany({
            where: { operationId },
            select: { montant: true, avenants: { select: { montant: true } } },
          }),
          tx.facture.findMany({
            where: { operationId, statut: { in: ['VALIDEE', 'PAYEE'] } },
            select: { montantHT: true },
          }),
        ]);

      // Reste à payer sur chaque appel : le montant appelé moins ce qui est
      // déjà tombé. C'est la créance vivante sur les acquéreurs.
      const creances = appelsOuverts
        .map((appel) => {
          const encaisse = appel.encaissements.reduce<Prisma.Decimal>(
            (total, e) => total.plus(e.montant),
            ZERO,
          );
          return {
            numero: appel.numero,
            lot: appel.reservation.lot.reference,
            dateEcheance: appel.dateEcheance,
            solde: appel.montant.minus(encaisse),
          };
        })
        .filter((c) => c.solde.greaterThan(0));

      const commande = contrats.reduce<Prisma.Decimal>(
        (total, contrat) =>
          total
            .plus(contrat.montant)
            // Un avenant porte un montant SIGNÉ : un travail en moins est
            // négatif et diminue le commandé (règle posée au Lot 4).
            .plus(
              contrat.avenants.reduce<Prisma.Decimal>(
                (sous, avenant) => sous.plus(avenant.montant),
                ZERO,
              ),
            ),
        ZERO,
      );
      const facture = facturesValidees.reduce<Prisma.Decimal>(
        (total, f) => total.plus(f.montantHT ?? ZERO),
        ZERO,
      );

      return {
        encaissements,
        paiements,
        creances,
        // Engagements hors taxe, comme les contrats dont ils sortent. Ils ne
        // s'additionnent pas aux flux de caisse ci-dessus : ils annoncent
        // seulement ce qui reste à commander en dépenses.
        engagements: { commande, facture, resteAFacturer: commande.minus(facture) },
      };
    });

    const mouvements: Mouvement[] = [
      ...encaissements.map<Mouvement>((e) => ({
        date: e.dateValeur,
        montant: e.montant,
        sens: 'ENCAISSEMENT',
        libelle: `Lot ${e.appelDeFonds.reservation.lot.reference}`,
        reference: e.appelDeFonds.numero,
      })),
      ...paiements.map<Mouvement>((p) => ({
        date: p.dateValeur,
        montant: p.montant,
        sens: 'DECAISSEMENT',
        libelle: p.facture.entreprise?.nom ?? 'Fournisseur',
        reference: p.facture.numero,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    const consolidation = consolider(mouvements);
    const totalCreances = creances.reduce<Prisma.Decimal>((t, c) => t.plus(c.solde), ZERO);

    return {
      position: consolidation.position.toFixed(2),
      totalEncaisse: consolidation.totalEncaisse.toFixed(2),
      totalDecaisse: consolidation.totalDecaisse.toFixed(2),
      creux: consolidation.creux
        ? { mois: consolidation.creux.mois, position: consolidation.creux.position.toFixed(2) }
        : null,
      mois: consolidation.mois.map((m) => ({
        mois: m.mois,
        encaisse: m.encaisse.toFixed(2),
        decaisse: m.decaisse.toFixed(2),
        net: m.net.toFixed(2),
        cumul: m.cumul.toFixed(2),
        nombreMouvements: m.nombreMouvements,
      })),
      attendu: {
        creancesAcquereurs: totalCreances.toFixed(2),
        nombreAppelsOuverts: creances.length,
        detail: creances.map((c) => ({
          numero: c.numero,
          lot: c.lot,
          dateEcheance: c.dateEcheance,
          solde: c.solde.toFixed(2),
        })),
      },
      engagements: {
        commandeHt: engagements.commande.toFixed(2),
        factureHt: engagements.facture.toFixed(2),
        resteAFacturerHt: engagements.resteAFacturer.toFixed(2),
      },
      mouvements: mouvements.map((m) => ({
        date: m.date,
        sens: m.sens,
        montant: m.montant.toFixed(2),
        libelle: m.libelle,
        reference: m.reference ?? null,
      })),
    };
  }
}
