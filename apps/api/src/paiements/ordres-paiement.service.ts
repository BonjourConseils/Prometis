import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  PaiementInvalide,
  construirePain001,
  total,
  verifier,
  type LignePaiement,
} from './pain001';

const ZERO = new Prisma.Decimal(0);

/**
 * L'ordre de paiement : le lot de factures qui part à la banque.
 *
 * Le geste existait déjà sur le papier — « Ordre de paiement n° 11 » chez
 * CB Promotions. Prometis le reprend tel quel : la comptabilité compose
 * l'ordre à partir des factures validées, le promoteur le **vise**, et le
 * fichier pain.001 ne se télécharge qu'après.
 *
 * L'ordre **fige** ce qui partira : montant, compte du créancier, référence.
 * Une facture corrigée ensuite ne réécrit pas un ordre déjà visé, et ce qui
 * est parti reste lisible tel quel.
 */
@Injectable()
export class OrdresPaiementService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===================================================================
  //  Le compte de la promotion
  // ===================================================================

  /** Le compte d'où partent les paiements — le crédit de construction. */
  async fixerCompte(operationId: number, donnees: { iban: string | null; bic?: string | null }) {
    return this.db.run(async (tx) => {
      const operation = await tx.operation.update({
        where: { id: operationId },
        data: { ibanPaiement: donnees.iban, bicPaiement: donnees.bic ?? null },
        select: { id: true, ibanPaiement: true, bicPaiement: true },
      });
      await this.audit.enregistrer(tx, {
        action: 'ordre_paiement.compte_fixe',
        entite: 'Operation',
        entiteId: operationId,
        // Le compte figure au journal : c'est lui qui paiera.
        donnees: { iban: operation.ibanPaiement },
      });
      return operation;
    });
  }

  // ===================================================================
  //  Ce qui attend d'être payé
  // ===================================================================

  /**
   * Les factures validées, non soldées, pas déjà dans un ordre vivant —
   * avec ce qu'il reste à payer et ce qui manque pour le faire.
   */
  async aPayer(operationId: number) {
    return this.db.run(async (tx) => {
      const factures = await tx.facture.findMany({
        where: {
          operationId,
          statut: 'VALIDEE',
          lignesOrdre: { none: { ordre: { statut: { not: 'ANNULE' } } } },
        },
        include: {
          entreprise: { select: { id: true, nom: true } },
          paiements: { select: { montant: true } },
        },
        orderBy: [{ dateEcheance: 'asc' }, { id: 'asc' }],
      });

      return factures.map((f) => {
        const paye = f.paiements.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO);
        const reste = montantAPayer(f).minus(paye);
        return {
          id: f.id,
          numero: f.numero,
          type: f.type,
          dateFacture: f.dateFacture,
          dateEcheance: f.dateEcheance,
          entreprise: f.entreprise,
          montant: reste.toFixed(2),
          iban: f.iban,
          reference: f.referenceQR,
          // Ce qui empêcherait de payer, dit avant de composer l'ordre.
          manque: [
            f.iban ? null : 'compte bancaire',
            reste.greaterThan(0) ? null : 'montant à payer',
          ].filter((x): x is string => x !== null),
        };
      });
    });
  }

  // ===================================================================
  //  L'ordre
  // ===================================================================

  async lister(operationId: number) {
    return this.db.run(async (tx) => {
      const ordres = await tx.ordrePaiement.findMany({
        where: { operationId },
        include: {
          lignes: { select: { montant: true } },
          visePar: { select: { compte: { select: { prenom: true, nom: true } } } },
        },
        orderBy: { numero: 'desc' },
      });
      return ordres.map((o) => ({
        id: o.id,
        numero: o.numero,
        libelle: o.libelle,
        statut: o.statut,
        dateExecution: o.dateExecution,
        viseLe: o.viseLe,
        visePar: o.visePar ? `${o.visePar.compte.prenom} ${o.visePar.compte.nom}` : null,
        transmisLe: o.transmisLe,
        nombre: o.lignes.length,
        total: o.lignes.reduce<Prisma.Decimal>((t, l) => t.plus(l.montant), ZERO).toFixed(2),
      }));
    });
  }

  async lire(operationId: number, ordreId: number) {
    return this.db.run(async (tx) => {
      const ordre = await this.ordreDeLOperation(tx, operationId, ordreId);
      return {
        ...ordre,
        total: total(lignesPaiement(ordre)),
        anomalies: verifier(this.aPayerBanque(ordre)),
      };
    });
  }

  /**
   * Compose l'ordre à partir des factures choisies.
   *
   * Les montants et les comptes sont recopiés ici : c'est la photographie
   * de ce qui partira. Une facture déjà dans un ordre vivant ne peut pas y
   * entrer deux fois — c'est ainsi qu'on paie deux fois la même chose.
   */
  async creer(
    operationId: number,
    donnees: { factureIds: number[]; libelle?: string | null; dateExecution: Date },
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;
    const societeId = RequestContext.requireSocieteId();

    return this.db.run(async (tx) => {
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: operationId },
        select: { ibanPaiement: true, bicPaiement: true },
      });
      if (!operation.ibanPaiement) {
        throw new BadRequestException(
          'Le compte de la promotion n’est pas renseigné : indiquez-le avant de composer un ordre.',
        );
      }

      const factures = await tx.facture.findMany({
        where: { id: { in: donnees.factureIds }, operationId },
        include: {
          entreprise: { select: { nom: true } },
          contrat: { select: { entreprise: { select: { nom: true } } } },
          paiements: { select: { montant: true } },
          lignesOrdre: { select: { ordre: { select: { numero: true, statut: true } } } },
        },
      });
      if (factures.length !== donnees.factureIds.length) {
        throw new NotFoundException('Une facture choisie n’appartient pas à cette promotion.');
      }

      const lignes = factures.map((f) => {
        const nom = f.entreprise?.nom ?? f.contrat?.entreprise.nom;
        const dansUnAutre = f.lignesOrdre.find((l) => l.ordre.statut !== 'ANNULE');
        const paye = f.paiements.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO);
        const reste = montantAPayer(f).minus(paye);
        const ou = `Facture ${f.numero ?? f.id}`;

        if (f.statut !== 'VALIDEE') {
          throw new BadRequestException(`${ou} n’est pas validée : elle ne peut pas être payée.`);
        }
        if (dansUnAutre) {
          throw new BadRequestException(
            `${ou} figure déjà dans l’ordre n° ${dansUnAutre.ordre.numero}.`,
          );
        }
        if (!nom) throw new BadRequestException(`${ou} : l’entreprise n’est pas identifiée.`);
        if (!f.iban) throw new BadRequestException(`${ou} : le compte du créancier manque.`);
        if (!reste.greaterThan(0)) throw new BadRequestException(`${ou} : rien à payer.`);

        return {
          factureId: f.id,
          montant: reste,
          creancierNom: nom,
          iban: f.iban,
          reference: f.referenceQR,
          communication: f.referenceQR ? null : `Facture ${f.numero ?? f.id}`.slice(0, 140),
        };
      });

      const dernier = await tx.ordrePaiement.findFirst({
        where: { operationId },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      });

      const ordre = await tx.ordrePaiement.create({
        data: {
          societeId,
          operationId,
          numero: (dernier?.numero ?? 0) + 1,
          libelle: donnees.libelle ?? null,
          dateExecution: donnees.dateExecution,
          ibanDebiteur: operation.ibanPaiement,
          bicDebiteur: operation.bicPaiement,
          creeParId: membershipId,
          lignes: { create: lignes },
        },
        include: { lignes: true },
      });

      await this.audit.enregistrer(tx, {
        action: 'ordre_paiement.compose',
        entite: 'OrdrePaiement',
        entiteId: ordre.id,
        donnees: {
          operationId,
          numero: ordre.numero,
          nombre: lignes.length,
          total: total(lignesPaiement(ordre)),
        },
      });
      return ordre;
    });
  }

  /**
   * Le visa du promoteur : c'est lui qui autorise la sortie d'argent.
   *
   * Ce qui ne passerait pas à la banque est refusé ici, pas au moment du
   * téléchargement : le promoteur vise un ordre exécutable.
   */
  async viser(operationId: number, ordreId: number) {
    const membershipId = RequestContext.requireWorkspace().membershipId;

    return this.db.run(async (tx) => {
      const ordre = await this.ordreDeLOperation(tx, operationId, ordreId);
      if (ordre.statut !== 'BROUILLON') {
        throw new BadRequestException(
          ordre.statut === 'VISE'
            ? 'Cet ordre est déjà visé.'
            : 'Cet ordre a été transmis ou annulé : il ne se vise plus.',
        );
      }
      const anomalies = verifier(this.aPayerBanque(ordre));
      if (anomalies.length) {
        throw new BadRequestException({
          message: 'Cet ordre ne peut pas partir tel quel.',
          anomalies,
        });
      }

      const vise = await tx.ordrePaiement.update({
        where: { id: ordreId },
        data: { statut: 'VISE', viseParId: membershipId, viseLe: new Date() },
      });
      await this.audit.enregistrer(tx, {
        action: 'ordre_paiement.vise',
        entite: 'OrdrePaiement',
        entiteId: ordreId,
        donnees: {
          operationId,
          numero: ordre.numero,
          total: total(lignesPaiement(ordre)),
          nombre: ordre.lignes.length,
        },
      });
      return vise;
    });
  }

  /** Un ordre qui ne partira pas : annulé, jamais effacé. */
  async annuler(operationId: number, ordreId: number) {
    return this.db.run(async (tx) => {
      const ordre = await this.ordreDeLOperation(tx, operationId, ordreId);
      if (ordre.statut === 'TRANSMIS') {
        throw new BadRequestException(
          'Cet ordre est parti à la banque : il ne s’annule plus ici, mais dans votre e-banking.',
        );
      }
      const annule = await tx.ordrePaiement.update({
        where: { id: ordreId },
        data: { statut: 'ANNULE' },
      });
      await this.audit.enregistrer(tx, {
        action: 'ordre_paiement.annule',
        entite: 'OrdrePaiement',
        entiteId: ordreId,
        donnees: { operationId, numero: ordre.numero, statutAvant: ordre.statut },
      });
      return annule;
    });
  }

  /**
   * Le fichier pain.001, et ce qu'il entraîne.
   *
   * Le télécharger vaut transmission : les factures sont réglées, la
   * colonne « payé » du fil rouge bouge. Un second téléchargement rend le
   * **même** fichier, avec le même identifiant de message — la banque
   * reconnaît un doublon plutôt que de payer deux fois.
   */
  async fichier(operationId: number, ordreId: number) {
    return this.db.run(async (tx) => {
      const ordre = await this.ordreDeLOperation(tx, operationId, ordreId);
      if (ordre.statut === 'BROUILLON') {
        throw new BadRequestException('Cet ordre doit être visé avant de partir à la banque.');
      }
      if (ordre.statut === 'ANNULE') {
        throw new BadRequestException('Cet ordre est annulé.');
      }

      const premiereFois = ordre.statut === 'VISE';
      const messageId = ordre.messageId ?? `PROMETIS-${operationId}-${ordre.numero}-${Date.now()}`;

      let xml: string;
      try {
        xml = construirePain001({ ...this.aPayerBanque(ordre), messageId });
      } catch (e) {
        if (e instanceof PaiementInvalide) throw new BadRequestException(e.message);
        throw e;
      }

      if (premiereFois) {
        const dateValeur = ordre.dateExecution ?? new Date();
        for (const l of ordre.lignes) {
          await tx.paiementFournisseur.create({
            data: {
              factureId: l.factureId,
              montant: l.montant,
              dateValeur,
              moyen: 'virement',
              reference: messageId,
            },
          });
          const facture = await tx.facture.findUniqueOrThrow({
            where: { id: l.factureId },
            include: { paiements: { select: { montant: true } } },
          });
          const paye = facture.paiements.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO);
          if (paye.greaterThanOrEqualTo(montantAPayer(facture))) {
            await tx.facture.update({ where: { id: l.factureId }, data: { statut: 'PAYEE' } });
          }
        }
        await tx.ordrePaiement.update({
          where: { id: ordreId },
          data: { statut: 'TRANSMIS', transmisLe: new Date(), messageId },
        });
        await this.audit.enregistrer(tx, {
          action: 'ordre_paiement.transmis',
          entite: 'OrdrePaiement',
          entiteId: ordreId,
          donnees: {
            operationId,
            numero: ordre.numero,
            messageId,
            total: total(lignesPaiement(ordre)),
            nombre: ordre.lignes.length,
          },
        });
      }

      return { nom: `ordre-paiement-${ordre.numero}.xml`, xml };
    });
  }

  // ===================================================================

  private async ordreDeLOperation(tx: TenantDb, operationId: number, ordreId: number) {
    const ordre = await tx.ordrePaiement.findFirst({
      where: { id: ordreId, operationId },
      include: {
        lignes: {
          include: { facture: { select: { numero: true, dateFacture: true, statut: true } } },
          orderBy: { id: 'asc' },
        },
        operation: { select: { nom: true, societe: { select: { raisonSociale: true } } } },
        visePar: { select: { compte: { select: { prenom: true, nom: true } } } },
      },
    });
    if (!ordre) throw new NotFoundException('Ordre de paiement introuvable.');
    return ordre;
  }

  /** L'ordre tel que la banque le recevra. */
  private aPayerBanque(ordre: OrdreEnBase) {
    return {
      messageId: ordre.messageId ?? `PROMETIS-${ordre.operationId}-${ordre.numero}`,
      creeLe: new Date(),
      debiteur: ordre.operation.societe.raisonSociale,
      ibanDebiteur: ordre.ibanDebiteur,
      bicDebiteur: ordre.bicDebiteur,
      dateExecution: ordre.dateExecution ?? new Date(),
      libelle: ordre.libelle,
      lignes: lignesPaiement(ordre),
    };
  }
}

type OrdreEnBase = Prisma.OrdrePaiementGetPayload<{
  include: {
    lignes: true;
    operation: { select: { nom: true; societe: { select: { raisonSociale: true } } } };
  };
}>;

function lignesPaiement(ordre: {
  numero: number;
  lignes: {
    factureId: number;
    montant: Prisma.Decimal;
    creancierNom: string;
    iban: string;
    reference: string | null;
    communication: string | null;
  }[];
}): LignePaiement[] {
  return ordre.lignes.map((l) => ({
    reference: `ORD${ordre.numero}-F${l.factureId}`,
    creancier: l.creancierNom,
    iban: l.iban,
    montant: l.montant.toFixed(2),
    referenceStructuree: l.reference,
    communication: l.communication,
  }));
}

/**
 * Ce qu'il faut payer sur une facture : le montant du bulletin QR quand il
 * y en a un, sinon le TTC net de la retenue et des acomptes qu'elle déduit.
 */
export function montantAPayer(f: {
  montantHT: Prisma.Decimal | null;
  montantTTC: Prisma.Decimal | null;
  retenueGarantie: Prisma.Decimal | null;
  acomptesDeduits: Prisma.Decimal | null;
  controles: Prisma.JsonValue | null;
}): Prisma.Decimal {
  const dit = (f.controles as { chiffres?: { aPayer?: unknown } } | null)?.chiffres?.aPayer;
  if (typeof dit === 'string' && dit.trim()) return new Prisma.Decimal(dit);
  const brut = f.montantTTC ?? f.montantHT;
  if (!brut) return ZERO;
  return brut.minus(f.retenueGarantie ?? 0).minus(f.acomptesDeduits ?? 0);
}
