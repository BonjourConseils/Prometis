import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BudgetVersionStatut } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { construireArbreCfc, ventiler, type CleVentilation, type MontantsNoeud } from './cfc-arbre';

export interface DonneesLigne {
  cfcNodeId: number;
  designation?: string | null;
  quantite?: Prisma.Decimal | null;
  prixUnitaire?: Prisma.Decimal | null;
  montant: Prisma.Decimal;
  tvaPct?: Prisma.Decimal | null;
  estReserve?: boolean;
  note?: string | null;
}

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class BudgetService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===================================================================
  //  Versions
  // ===================================================================

  private async versionDeLOperation(tx: TenantDb, operationId: number, versionId: number) {
    const version = await tx.budgetVersion.findFirst({
      where: { id: versionId, operationId },
      select: { id: true, libelle: true, statut: true, isCourant: true },
    });
    if (!version) {
      throw new NotFoundException(
        `Version de budget ${versionId} introuvable dans cette opération.`,
      );
    }
    return version;
  }

  async listerVersions(operationId: number) {
    return this.db.run((tx) =>
      tx.budgetVersion.findMany({
        where: { operationId },
        include: { _count: { select: { lignes: true } } },
        orderBy: { id: 'asc' },
      }),
    );
  }

  /**
   * Crée une version. `copierDepuisId` duplique les lignes d'une version
   * existante — c'est le geste normal d'une révision : on part du budget
   * courant et on ajuste, on ne resaisit pas 40 postes.
   *
   * La nouvelle version n'est **pas** courante d'office : une révision se
   * travaille avant d'être adoptée.
   */
  async creerVersion(
    operationId: number,
    donnees: { libelle: string; commentaire?: string | null; copierDepuisId?: number | null },
  ) {
    return this.db.run(async (tx) => {
      const version = await tx.budgetVersion.create({
        data: {
          operationId,
          libelle: donnees.libelle,
          commentaire: donnees.commentaire ?? null,
          statut: 'BROUILLON',
          isCourant: false,
        },
      });

      let lignesCopiees = 0;
      if (donnees.copierDepuisId) {
        const source = await this.versionDeLOperation(tx, operationId, donnees.copierDepuisId);
        const lignes = await tx.ligneBudget.findMany({ where: { budgetVersionId: source.id } });
        if (lignes.length > 0) {
          await tx.ligneBudget.createMany({
            data: lignes.map((l) => ({
              budgetVersionId: version.id,
              cfcNodeId: l.cfcNodeId,
              designation: l.designation,
              quantite: l.quantite,
              prixUnitaire: l.prixUnitaire,
              montant: l.montant,
              tvaPct: l.tvaPct,
              estReserve: l.estReserve,
              note: l.note,
            })),
          });
          lignesCopiees = lignes.length;
        }
      }

      await this.audit.enregistrer(tx, {
        action: 'budget_version.creee',
        entite: 'BudgetVersion',
        entiteId: version.id,
        donnees: { operationId, libelle: version.libelle, lignesCopiees },
      });

      return { ...version, lignesCopiees };
    });
  }

  /**
   * Modifie une version, et garantit l'unicité de la version courante.
   *
   * L'invariant « une seule `isCourant` par opération » n'est pas porté par
   * le schéma : c'est ici qu'il tient. Deux budgets courants, et le bilan
   * promoteur compterait deux fois les mêmes postes.
   */
  async modifierVersion(
    operationId: number,
    versionId: number,
    donnees: {
      libelle?: string;
      statut?: BudgetVersionStatut;
      isCourant?: boolean;
      commentaire?: string | null;
    },
  ) {
    return this.db.run(async (tx) => {
      const avant = await this.versionDeLOperation(tx, operationId, versionId);

      if (donnees.isCourant === true) {
        // Un budget courant est un budget adopté : on refuse de rendre
        // courante une version encore en brouillon.
        const statutFinal = donnees.statut ?? avant.statut;
        if (statutFinal === 'BROUILLON') {
          throw new BadRequestException(
            'Une version en brouillon ne peut pas devenir courante. La valider d’abord.',
          );
        }
        await tx.budgetVersion.updateMany({
          where: { operationId, NOT: { id: versionId } },
          data: { isCourant: false },
        });
      }

      if (donnees.isCourant === false && avant.isCourant) {
        throw new BadRequestException(
          'Une opération doit garder une version courante. Rendre une autre version courante à la place.',
        );
      }

      const version = await tx.budgetVersion.update({ where: { id: versionId }, data: donnees });

      await this.audit.enregistrer(tx, {
        action: 'budget_version.modifiee',
        entite: 'BudgetVersion',
        entiteId: versionId,
        donnees: {
          operationId,
          avant: { statut: avant.statut, isCourant: avant.isCourant },
          apres: { statut: version.statut, isCourant: version.isCourant },
        },
      });
      return version;
    });
  }

  // ===================================================================
  //  Lignes
  // ===================================================================

  async listerLignes(operationId: number, versionId: number) {
    return this.db.run(async (tx) => {
      await this.versionDeLOperation(tx, operationId, versionId);
      return tx.ligneBudget.findMany({
        where: { budgetVersionId: versionId },
        include: { cfcNode: { select: { id: true, code: true, libelle: true, niveau: true } } },
        orderBy: { id: 'asc' },
      });
    });
  }

  async creerLigne(operationId: number, versionId: number, donnees: DonneesLigne) {
    return this.db.run(async (tx) => {
      const version = await this.versionDeLOperation(tx, operationId, versionId);
      if (version.statut === 'ARCHIVE') {
        throw new BadRequestException("Cette version est archivée : elle n'est plus modifiable.");
      }

      const noeud = await tx.cfcNode.findFirst({
        where: { id: donnees.cfcNodeId, operationId },
        select: { id: true, code: true },
      });
      if (!noeud) {
        throw new NotFoundException(
          `Poste CFC ${donnees.cfcNodeId} introuvable dans cette opération.`,
        );
      }

      const ligne = await tx.ligneBudget.create({
        data: { budgetVersionId: versionId, ...donnees },
      });

      await this.audit.enregistrer(tx, {
        action: 'budget_ligne.creee',
        entite: 'LigneBudget',
        entiteId: ligne.id,
        donnees: { operationId, versionId, cfc: noeud.code, montant: ligne.montant },
      });
      return ligne;
    });
  }

  async modifierLigne(operationId: number, ligneId: number, donnees: Partial<DonneesLigne>) {
    return this.db.run(async (tx) => {
      const ligne = await tx.ligneBudget.findFirst({
        where: { id: ligneId, budgetVersion: { operationId } },
        include: { budgetVersion: { select: { id: true, statut: true } } },
      });
      if (!ligne) throw new NotFoundException(`Ligne de budget ${ligneId} introuvable.`);
      if (ligne.budgetVersion.statut === 'ARCHIVE') {
        throw new BadRequestException("Cette version est archivée : elle n'est plus modifiable.");
      }

      if (donnees.cfcNodeId !== undefined) {
        const noeud = await tx.cfcNode.findFirst({
          where: { id: donnees.cfcNodeId, operationId },
          select: { id: true },
        });
        if (!noeud) throw new NotFoundException(`Poste CFC ${donnees.cfcNodeId} introuvable.`);
      }

      const apres = await tx.ligneBudget.update({ where: { id: ligneId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'budget_ligne.modifiee',
        entite: 'LigneBudget',
        entiteId: ligneId,
        donnees: {
          operationId,
          avantMontant: ligne.montant,
          apresMontant: apres.montant,
          champs: Object.keys(donnees),
        },
      });
      return apres;
    });
  }

  async supprimerLigne(operationId: number, ligneId: number) {
    return this.db.run(async (tx) => {
      const ligne = await tx.ligneBudget.findFirst({
        where: { id: ligneId, budgetVersion: { operationId } },
        include: { budgetVersion: { select: { statut: true } } },
      });
      if (!ligne) throw new NotFoundException(`Ligne de budget ${ligneId} introuvable.`);
      if (ligne.budgetVersion.statut === 'ARCHIVE') {
        throw new BadRequestException("Cette version est archivée : elle n'est plus modifiable.");
      }

      await tx.ligneBudget.delete({ where: { id: ligneId } });
      await this.audit.enregistrer(tx, {
        action: 'budget_ligne.supprimee',
        entite: 'LigneBudget',
        entiteId: ligneId,
        donnees: { operationId, montant: ligne.montant },
      });
      return { supprime: true };
    });
  }

  // ===================================================================
  //  Vue consolidée — le fil rouge
  // ===================================================================

  /**
   * L'arbre CFC avec les colonnes du fil rouge.
   *
   * Tous les montants sont **hors taxe**, comme les lignes de budget : la TVA
   * est portée à part (`tvaPct`). Comparer un budget HT à une facture TTC
   * afficherait un dépassement de 8,1 % qui n'existe pas.
   *
   * Les colonnes adjugé, commandé, facturé et payé sont déjà calculées bien
   * qu'elles restent à zéro tant que les lots 4 et 5 n'ont rien produit :
   * la vue est ainsi juste dès le premier contrat, sans changement de code.
   */
  async vueConsolidee(operationId: number, versionId?: number) {
    const donnees = await this.db.run(async (tx) => {
      const noeuds = await tx.cfcNode.findMany({
        where: { operationId },
        select: { id: true, parentId: true, code: true, libelle: true, niveau: true, ordre: true },
      });

      const versions = await tx.budgetVersion.findMany({
        where: { operationId },
        orderBy: { id: 'asc' },
        select: { id: true, libelle: true, statut: true, isCourant: true },
      });

      // « Initial » = la première version créée. Le schéma ne porte pas de
      // drapeau : c'est la convention, et elle est explicite ici.
      const initiale = versions[0] ?? null;
      const courante = versions.find((v) => v.isCourant) ?? initiale;
      const affichee = versionId
        ? (versions.find((v) => v.id === versionId) ?? null)
        : (courante ?? null);

      if (versionId && !affichee) {
        throw new NotFoundException(`Version de budget ${versionId} introuvable.`);
      }

      const lignes = await tx.ligneBudget.findMany({
        where: { budgetVersion: { operationId } },
        select: { budgetVersionId: true, cfcNodeId: true, montant: true, estReserve: true },
      });

      const adjudications = await tx.adjudication.findMany({
        where: { soumission: { operationId } },
        select: { montantAdjuge: true, soumission: { select: { cfcNodeId: true } } },
      });

      const contrats = await tx.contrat.findMany({
        where: { operationId },
        select: { cfcNodeId: true, montant: true },
      });

      const avenants = await tx.avenant.findMany({
        where: { contrat: { operationId } },
        select: { cfcNodeId: true, montant: true, contrat: { select: { cfcNodeId: true } } },
      });

      const factures = await tx.facture.findMany({
        where: { operationId, statut: { in: ['VALIDEE', 'PAYEE'] } },
        select: {
          id: true,
          cfcNodeId: true,
          montantHT: true,
          montantTTC: true,
          paiements: { select: { montant: true } },
        },
      });

      return {
        noeuds,
        versions,
        initiale,
        courante,
        affichee,
        lignes,
        adjudications,
        contrats,
        avenants,
        factures,
      };
    });

    const montants: MontantsNoeud[] = [];
    const ajouter = (
      cfcNodeId: number | null,
      colonne: keyof Omit<MontantsNoeud, 'cfcNodeId'>,
      valeur: Prisma.Decimal | null,
    ) => {
      if (cfcNodeId === null || valeur === null) return;
      montants.push({ cfcNodeId, [colonne]: valeur });
    };

    for (const l of donnees.lignes) {
      if (donnees.initiale && l.budgetVersionId === donnees.initiale.id) {
        ajouter(l.cfcNodeId, 'budgeteInitial', l.montant);
      }
      if (donnees.affichee && l.budgetVersionId === donnees.affichee.id) {
        ajouter(l.cfcNodeId, 'budgeteRevise', l.montant);
      }
    }

    for (const a of donnees.adjudications) {
      ajouter(a.soumission.cfcNodeId, 'adjuge', a.montantAdjuge);
    }
    for (const c of donnees.contrats) {
      ajouter(c.cfcNodeId, 'commande', c.montant);
    }
    for (const a of donnees.avenants) {
      // Un avenant peut viser un autre poste que son contrat : on suit son
      // propre CFC quand il en a un.
      ajouter(a.cfcNodeId ?? a.contrat.cfcNodeId, 'commande', a.montant);
    }
    for (const f of donnees.factures) {
      ajouter(f.cfcNodeId, 'facture', f.montantHT);

      // Les paiements sont encaissés en TTC ; la colonne « payé » doit rester
      // hors taxe comme les autres, sinon elle afficherait 8,1 % de plus que
      // le facturé sur une facture pourtant soldée. On convertit à la part
      // réglée, plafonnée au montant HT.
      const payeTTC = f.paiements.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO);
      if (!payeTTC.isZero() && f.montantHT) {
        const du = f.montantTTC ?? f.montantHT;
        const part = du.isZero() ? ZERO : payeTTC.dividedBy(du);
        const payeHT = part.greaterThanOrEqualTo(1)
          ? f.montantHT
          : f.montantHT.times(part).toDecimalPlaces(2);
        ajouter(f.cfcNodeId, 'paye', payeHT);
      }
    }

    const { arbre, total } = construireArbreCfc(donnees.noeuds, montants);

    const reserves = donnees.lignes
      .filter((l) => l.estReserve && donnees.affichee && l.budgetVersionId === donnees.affichee.id)
      .reduce<Prisma.Decimal>((t, l) => t.plus(l.montant), ZERO);

    return {
      versions: donnees.versions,
      versionInitiale: donnees.initiale,
      versionCourante: donnees.courante,
      versionAffichee: donnees.affichee,
      arbre,
      total: {
        ...total,
        reserves,
        resteAEngager: total.budgeteRevise.minus(total.commande),
        resteADepenser: total.commande.minus(total.facture),
        ecartRevisionInitial: total.budgeteRevise.minus(total.budgeteInitial),
      },
    };
  }

  /**
   * Ventile le budget courant sur les lots de l'opération.
   *
   * Sert au promoteur à répondre à « combien coûte le lot A02 ? » — une
   * question qu'il se pose au moment de fixer un prix de vente.
   */
  async ventilation(operationId: number, cle: CleVentilation, versionId?: number) {
    const { lots, montantTotal, version } = await this.db.run(async (tx) => {
      const version = versionId
        ? await this.versionDeLOperation(tx, operationId, versionId)
        : await tx.budgetVersion.findFirst({
            where: { operationId, isCourant: true },
            select: { id: true, libelle: true, statut: true, isCourant: true },
          });

      if (!version) {
        throw new BadRequestException(
          'Aucune version de budget courante sur cette opération : rien à ventiler.',
        );
      }

      const lignes = await tx.ligneBudget.findMany({
        where: { budgetVersionId: version.id },
        select: { montant: true },
      });

      const lots = await tx.lot.findMany({
        where: { bien: { operationId } },
        select: { id: true, reference: true, quotePartPPE: true, surfaceM2: true },
        orderBy: { reference: 'asc' },
      });

      return {
        version,
        lots,
        montantTotal: lignes.reduce<Prisma.Decimal>((t, l) => t.plus(l.montant), ZERO),
      };
    });

    const { parts, cleEffective } = ventiler(montantTotal, lots, cle);

    return {
      version,
      cleDemandee: cle,
      cleEffective,
      montantTotal,
      // Contrôle explicite : la somme des parts doit retomber exactement sur
      // le montant ventilé. L'exposer évite d'avoir à faire confiance.
      sommeParts: parts.reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO),
      parts,
    };
  }
}
