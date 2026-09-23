import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FactureStatut, type FactureType } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { extraireChamps } from './extraction';
import { OcrService } from './ocr.service';
import { valeurDansBase } from './controles';
import {
  controlerCumul,
  suggererImputation,
  type CandidatContrat,
  type ControleCumul,
} from './rapprochement';

const ZERO = new Prisma.Decimal(0);

export interface DonneesFacture {
  contratId?: number | null;
  entrepriseId?: number | null;
  cfcNodeId?: number | null;
  type?: FactureType;
  numero?: string | null;
  dateFacture?: Date | null;
  montantHT?: Prisma.Decimal | null;
  tvaPct?: Prisma.Decimal | null;
  montantTTC?: Prisma.Decimal | null;
  fichierUrl?: string | null;
  ocrTexte?: string | null;
  montantTVA?: Prisma.Decimal | null;
  retenueGarantie?: Prisma.Decimal | null;
  acomptesDeduits?: Prisma.Decimal | null;
  dateEcheance?: Date | null;
  iban?: string | null;
}

/** États depuis lesquels une facture est encore modifiable. */
const MODIFIABLES: FactureStatut[] = ['RECUE', 'EN_LECTURE', 'A_VALIDER', 'LITIGE'];

@Injectable()
export class FacturesService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly ocr: OcrService,
  ) {}

  /**
   * Dépose un PDF sur une facture, en extrait le texte, puis analyse.
   *
   * Le texte extrait est conservé dans `ocrTexte` : c'est lui qui justifie
   * ce que la lecture automatique a proposé. Sans lui, un comptable qui
   * conteste une imputation n'aurait rien à relire.
   */
  async extraireDepuisPdf(operationId: number, factureId: number, pdf: Buffer) {
    const texte = await this.ocr.extraire(pdf);

    await this.db.run(async (tx) => {
      await this.factureDeLOperation(tx, operationId, factureId);
      await tx.facture.update({
        where: { id: factureId },
        // Le statut reste EN_ATTENTE : c'est `analyser()` qui le passera à
        // TRAITEE. Le marquer traité ici mentirait — le texte est extrait,
        // les champs ne sont pas encore lus.
        data: { ocrTexte: texte, ocrStatut: 'EN_ATTENTE' },
      });
    });

    return this.analyser(operationId, factureId);
  }

  private async factureDeLOperation(tx: TenantDb, operationId: number, factureId: number) {
    const facture = await tx.facture.findFirst({
      where: { id: factureId, operationId },
      include: {
        contrat: { select: { id: true, reference: true, cfcNodeId: true } },
        entreprise: { select: { id: true, nom: true } },
        paiements: { select: { montant: true } },
      },
    });
    if (!facture) {
      throw new NotFoundException(`Facture ${factureId} introuvable dans cette opération.`);
    }
    return facture;
  }

  /** Contrats de l'opération, avec commandé et déjà-facturé — base du rapprochement. */
  private async candidats(tx: TenantDb, operationId: number): Promise<CandidatContrat[]> {
    const contrats = await tx.contrat.findMany({
      where: { operationId },
      select: {
        id: true,
        reference: true,
        montant: true,
        cfcNodeId: true,
        entreprise: { select: { id: true, nom: true } },
        avenants: { select: { montant: true } },
        base: true,
        factures: {
          where: { statut: { in: ['VALIDEE', 'PAYEE'] } },
          select: { montantHT: true, montantTTC: true, tvaPct: true },
        },
      },
    });

    return contrats.map((c) => ({
      contratId: c.id,
      reference: c.reference,
      entrepriseId: c.entreprise.id,
      entrepriseNom: c.entreprise.nom,
      cfcNodeId: c.cfcNodeId,
      montantCommande: c.avenants.reduce<Prisma.Decimal>((t, a) => t.plus(a.montant), c.montant),
      base: c.base,
      dejaFacture: c.factures.reduce<Prisma.Decimal>(
        (t, f) => t.plus(valeurDansBase(f, c.base) ?? 0),
        ZERO,
      ),
    }));
  }

  // ===================================================================
  //  Saisie
  // ===================================================================

  /** Tout ce que l'écran d'une facture affiche : pièce, lecture, rapport, visas. */
  async detail(operationId: number, factureId: number) {
    return this.db.run(async (tx) => {
      const f = await tx.facture.findFirst({
        where: { id: factureId, operationId },
        include: {
          entreprise: { select: { id: true, nom: true, ide: true } },
          contrat: {
            select: {
              id: true,
              reference: true,
              montant: true,
              retenueGarantiePct: true,
              cfcNode: { select: { code: true, libelle: true } },
            },
          },
          cfcNode: { select: { id: true, code: true, libelle: true } },
          lignes: { orderBy: { ordre: 'asc' } },
          visas: { orderBy: { id: 'asc' } },
          paiements: { select: { id: true, montant: true, dateValeur: true } },
          operation: { select: { nom: true, directionTravauxId: true } },
        },
      });
      if (!f) throw new NotFoundException(`Facture ${factureId} introuvable dans cette opération.`);
      const signataires = await tx.membership.findMany({
        where: {
          id: {
            in: [
              ...f.visas.map((v) => v.parId),
              ...(f.operation.directionTravauxId ? [f.operation.directionTravauxId] : []),
            ],
          },
        },
        select: {
          id: true,
          compte: { select: { prenom: true, nom: true, email: true } },
          acteur: { select: { societeNom: true } },
        },
      });
      const nom = (id: number) => {
        const m = signataires.find((x) => x.id === id);
        if (!m) return `membre ${id}`;
        const n = [m.compte.prenom, m.compte.nom].filter(Boolean).join(' ') || m.compte.email;
        return m.acteur?.societeNom ? `${n} (${m.acteur.societeNom})` : n;
      };
      // Le texte brut reste en base, pas dans la réponse : il peut être long.
      const { ocrTexte, ...reste } = f;
      return {
        ...reste,
        texteDisponible: !!ocrTexte,
        directionTravaux: f.operation.directionTravauxId
          ? {
              membershipId: f.operation.directionTravauxId,
              nom: nom(f.operation.directionTravauxId),
            }
          : null,
        visas: f.visas.map((v) => ({ ...v, par: nom(v.parId) })),
      };
    });
  }

  /** Les lignes corrigées à la main remplacent celles de la lecture. */
  async fixerLignes(
    operationId: number,
    factureId: number,
    lignes: { designation: string; codeCfc?: string | null; montant: Prisma.Decimal }[],
  ) {
    return this.db.run(async (tx) => {
      const f = await this.factureDeLOperation(tx, operationId, factureId);
      if (!MODIFIABLES.includes(f.statut)) {
        throw new BadRequestException('Facture validée : ses lignes ne se modifient plus.');
      }
      await tx.factureLigne.deleteMany({ where: { factureId } });
      await tx.factureLigne.createMany({
        data: lignes.map((l, i) => ({
          factureId,
          designation: l.designation,
          codeCfc: l.codeCfc ?? null,
          montant: l.montant,
          ordre: i,
        })),
      });
      await this.audit.enregistrer(tx, {
        action: 'facture.lignes_corrigees',
        entite: 'Facture',
        entiteId: factureId,
        donnees: { operationId, lignes: lignes.length },
      });
    });
  }

  async lister(operationId: number, statut?: FactureStatut) {
    return this.db.run((tx) =>
      tx.facture.findMany({
        where: { operationId, ...(statut ? { statut } : {}) },
        include: {
          entreprise: { select: { id: true, nom: true } },
          cfcNode: { select: { id: true, code: true, libelle: true } },
          contrat: { select: { id: true, reference: true } },
          paiements: { select: { id: true, montant: true, dateValeur: true } },
        },
        orderBy: [{ dateFacture: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  async creer(operationId: number, donnees: DonneesFacture) {
    const societeId = RequestContext.requireSocieteId();

    return this.db.run(async (tx) => {
      if (donnees.contratId) {
        const contrat = await tx.contrat.findFirst({
          where: { id: donnees.contratId, operationId },
          select: { id: true },
        });
        if (!contrat) throw new NotFoundException(`Contrat ${donnees.contratId} introuvable.`);
      }

      const facture = await tx.facture.create({
        data: { societeId, operationId, ...donnees },
      });

      await this.audit.enregistrer(tx, {
        action: 'facture.recue',
        entite: 'Facture',
        entiteId: facture.id,
        donnees: { operationId, numero: facture.numero, montantHT: facture.montantHT },
      });
      return facture;
    });
  }

  async modifier(operationId: number, factureId: number, donnees: Partial<DonneesFacture>) {
    return this.db.run(async (tx) => {
      const avant = await this.factureDeLOperation(tx, operationId, factureId);
      if (!MODIFIABLES.includes(avant.statut)) {
        throw new BadRequestException(
          `Une facture ${avant.statut.toLowerCase()} n'est plus modifiable. La remettre en litige d'abord.`,
        );
      }

      const facture = await tx.facture.update({ where: { id: factureId }, data: donnees });
      await this.audit.enregistrer(tx, {
        action: 'facture.modifiee',
        entite: 'Facture',
        entiteId: factureId,
        donnees: { operationId, champs: Object.keys(donnees) },
      });
      return facture;
    });
  }

  // ===================================================================
  //  Lecture automatique et proposition d'imputation
  // ===================================================================

  /**
   * Analyse une facture : lit ses champs depuis le texte, puis propose une
   * imputation CFC rapprochée des contrats.
   *
   * Deux règles fermes :
   *   · rien n'écrase une valeur déjà saisie — la machine complète, elle ne
   *     corrige pas un humain ;
   *   · le CFC proposé va dans `cfcSuggereId`, **jamais** dans `cfcNodeId`.
   *     L'imputation réelle n'existe qu'après validation humaine.
   */
  async analyser(operationId: number, factureId: number) {
    return this.db.run(async (tx) => {
      const facture = await this.factureDeLOperation(tx, operationId, factureId);

      if (!facture.ocrTexte) {
        await tx.facture.update({
          where: { id: factureId },
          data: { ocrStatut: 'ECHOUEE' },
        });
        throw new BadRequestException(
          'Aucun texte à analyser sur cette facture. Déposer le PDF sur cette facture ' +
            'pour que le serveur en extraie le texte, ou fournir `ocrTexte` à la main.',
        );
      }

      const champs = extraireChamps(facture.ocrTexte);
      const candidatsContrats = await this.candidats(tx, operationId);

      const suggestion = suggererImputation(
        {
          fournisseurNom: champs.fournisseurNom,
          montantHT: facture.montantHT ?? champs.montantHT,
          texte: facture.ocrTexte,
          entrepriseId: facture.entrepriseId,
        },
        candidatsContrats,
      );

      // `??` et non affectation directe : on ne complète que les vides.
      const misAJour = await tx.facture.update({
        where: { id: factureId },
        data: {
          numero: facture.numero ?? champs.numero,
          dateFacture: facture.dateFacture ?? champs.dateFacture,
          montantHT: facture.montantHT ?? champs.montantHT,
          tvaPct: facture.tvaPct ?? champs.tvaPct,
          montantTTC: facture.montantTTC ?? champs.montantTTC,
          entrepriseId: facture.entrepriseId ?? suggestion.entrepriseId,
          contratId: facture.contratId ?? suggestion.contratId,
          cfcSuggereId: suggestion.cfcNodeId,
          ocrConfiance: suggestion.confiance,
          ocrStatut: 'TRAITEE',
          statut: facture.statut === 'RECUE' ? 'A_VALIDER' : facture.statut,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'facture.analysee',
        entite: 'Facture',
        entiteId: factureId,
        donnees: {
          operationId,
          cfcSuggereId: suggestion.cfcNodeId,
          confiance: suggestion.confiance,
          motif: suggestion.motif,
        },
      });

      return { facture: misAJour, champs, suggestion };
    });
  }

  // ===================================================================
  //  Contrôle et validation
  // ===================================================================

  /** Le contrôle « facturé cumulé ≤ commandé », sans rien modifier. */
  async controler(operationId: number, factureId: number): Promise<ControleCumul | null> {
    return this.db.run(async (tx) => {
      const facture = await this.factureDeLOperation(tx, operationId, factureId);
      if (!facture.contratId) return null;

      const candidat = (await this.candidats(tx, operationId)).find(
        (c) => c.contratId === facture.contratId,
      );
      if (!candidat) return null;

      // La facture courante ne doit pas compter deux fois si elle est déjà
      // validée : on la retire du cumul avant de la réinjecter.
      const valeur = valeurDansBase(facture, candidat.base) ?? ZERO;
      const dejaComptee = ['VALIDEE', 'PAYEE'].includes(facture.statut) ? valeur : ZERO;

      return controlerCumul(
        candidat.montantCommande,
        candidat.dejaFacture.minus(dejaComptee),
        valeur,
      );
    });
  }

  /**
   * Valide une facture et l'impute définitivement à un poste CFC.
   *
   * C'est la seule voie par laquelle une facture entre dans la colonne
   * « facturé » du fil rouge. Le contrôle de cumul est **bloquant** : un
   * dépassement signale un avenant manquant ou une facture en trop, et dans
   * les deux cas il faut s'arrêter.
   */
  async valider(
    operationId: number,
    factureId: number,
    donnees: { cfcNodeId?: number | null; contratId?: number | null; forcer?: boolean },
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;

    return this.db.run(async (tx) => {
      const facture = await this.factureDeLOperation(tx, operationId, factureId);

      if (facture.statut === 'VALIDEE' || facture.statut === 'PAYEE') {
        throw new BadRequestException('Cette facture est déjà validée.');
      }
      if (facture.statut === 'EN_LECTURE') {
        throw new BadRequestException('La facture est en cours de lecture : attendez le rapport.');
      }

      // La direction des travaux, quand elle est nommée, a la main : sans son
      // visa favorable — le plus récent —, le promoteur ne valide pas.
      const operation = await tx.operation.findUniqueOrThrow({
        where: { id: operationId },
        select: { directionTravauxId: true },
      });
      if (operation.directionTravauxId) {
        const dernier = await tx.factureVisa.findFirst({
          where: { factureId, etape: 'DIRECTION_TRAVAUX' },
          orderBy: { id: 'desc' },
          select: { decision: true },
        });
        if (dernier?.decision !== 'APPROUVE') {
          throw new BadRequestException(
            dernier
              ? 'La direction des travaux a refusé cette facture : elle doit la viser à nouveau avant validation.'
              : 'La direction des travaux doit d’abord viser cette facture.',
          );
        }
      }

      // Un constat critique du contrôle (compte bancaire changé, doublon)
      // arrête la validation, comme un dépassement : on passe outre en le
      // disant, et c'est journalisé.
      const rapport = facture.controles as {
        constats?: { code: string; gravite: string; titre: string }[];
      } | null;
      const critiques = (rapport?.constats ?? []).filter(
        (k) => k.gravite === 'critique' && k.code !== 'depassement',
      );
      if (critiques.length && !donnees.forcer) {
        throw new BadRequestException({
          message: `Contrôle : ${critiques.map((k) => k.titre).join(' · ')} Confirmez en connaissance de cause pour valider.`,
          critiques: critiques.map((k) => k.code),
        });
      }
      if (facture.montantHT === null || facture.montantHT.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          "Le montant hors taxe est requis pour valider : c'est lui qui entre dans le fil rouge.",
        );
      }

      const contratId = donnees.contratId ?? facture.contratId;
      // L'imputation retenue : le CFC choisi, sinon celui du contrat, sinon
      // la proposition. Jamais l'inverse — la proposition ne s'impose pas.
      const cfcNodeId =
        donnees.cfcNodeId ??
        facture.cfcNodeId ??
        facture.contrat?.cfcNodeId ??
        facture.cfcSuggereId;

      if (!cfcNodeId) {
        throw new BadRequestException(
          'Aucun poste CFC : une facture ne peut pas être validée sans imputation.',
        );
      }

      const noeud = await tx.cfcNode.findFirst({
        where: { id: cfcNodeId, operationId },
        select: { id: true, code: true },
      });
      if (!noeud) throw new NotFoundException(`Poste CFC ${cfcNodeId} introuvable.`);

      let controle: ControleCumul | null = null;
      if (contratId) {
        const candidat = (await this.candidats(tx, operationId)).find(
          (c) => c.contratId === contratId,
        );
        if (candidat) {
          controle = controlerCumul(
            candidat.montantCommande,
            candidat.dejaFacture,
            valeurDansBase(facture, candidat.base) ?? facture.montantHT,
          );

          if (controle.depasse && !donnees.forcer) {
            throw new BadRequestException({
              message:
                `Le cumul facturé dépasserait le commandé de ${controle.depassement.toFixed(2)} CHF ` +
                `(${controle.cumulApres.toFixed(2)} contre ${controle.commande.toFixed(2)}). ` +
                'Un avenant manque, ou cette facture est en trop.',
              controle: {
                commande: controle.commande.toFixed(2),
                dejaFacture: controle.dejaFacture.toFixed(2),
                cumulApres: controle.cumulApres.toFixed(2),
                depassement: controle.depassement.toFixed(2),
              },
            });
          }
        }
      }

      const validee = await tx.facture.update({
        where: { id: factureId },
        data: {
          cfcNodeId,
          contratId,
          statut: 'VALIDEE',
          validePar: membershipId,
          dateValidation: new Date(),
        },
      });

      await tx.factureVisa.create({
        data: { factureId, etape: 'PROMOTEUR', decision: 'APPROUVE', parId: membershipId },
      });

      await this.audit.enregistrer(tx, {
        action: 'facture.validee',
        entite: 'Facture',
        entiteId: factureId,
        donnees: {
          operationId,
          numero: facture.numero,
          montantHT: facture.montantHT,
          cfc: noeud.code,
          contratId,
          // Un forçage doit rester lisible dans la piste d'audit.
          depassementForce: controle?.depasse ? controle.depassement : null,
          constatsForces: critiques.map((k) => k.code),
        },
      });

      return validee;
    });
  }

  /** Rejet ou mise en litige — avec un motif, sinon la trace ne sert à rien. */
  async changerStatut(
    operationId: number,
    factureId: number,
    statut: Extract<FactureStatut, 'LITIGE' | 'REJETEE' | 'A_VALIDER'>,
    motif: string,
  ) {
    return this.db.run(async (tx) => {
      const facture = await this.factureDeLOperation(tx, operationId, factureId);
      if (facture.paiements.length > 0 && statut !== 'A_VALIDER') {
        throw new BadRequestException(
          'Cette facture a des paiements enregistrés : la rejeter laisserait des paiements orphelins.',
        );
      }

      const misAJour = await tx.facture.update({ where: { id: factureId }, data: { statut } });
      await this.audit.enregistrer(tx, {
        action: `facture.${statut.toLowerCase()}`,
        entite: 'Facture',
        entiteId: factureId,
        donnees: { operationId, avant: facture.statut, motif },
      });
      return misAJour;
    });
  }

  // ===================================================================
  //  Paiements
  // ===================================================================

  /**
   * Enregistre un paiement fournisseur.
   *
   * La facture passe à PAYEE quand le cumul des paiements atteint le TTC —
   * un acompte partiel ne solde pas la facture.
   */
  async enregistrerPaiement(
    operationId: number,
    factureId: number,
    donnees: {
      montant: Prisma.Decimal;
      dateValeur: Date;
      moyen?: string | null;
      reference?: string | null;
    },
  ) {
    return this.db.run(async (tx) => {
      const facture = await this.factureDeLOperation(tx, operationId, factureId);
      if (facture.statut !== 'VALIDEE' && facture.statut !== 'PAYEE') {
        throw new BadRequestException(
          'Seule une facture validée peut être payée : valider avant de régler.',
        );
      }

      const paiement = await tx.paiementFournisseur.create({
        data: { factureId, ...donnees },
      });

      const cumulPaye = facture.paiements
        .reduce<Prisma.Decimal>((t, p) => t.plus(p.montant), ZERO)
        .plus(donnees.montant);
      const du = facture.montantTTC ?? facture.montantHT ?? ZERO;
      const solde = !du.isZero() && cumulPaye.greaterThanOrEqualTo(du);

      if (solde) {
        await tx.facture.update({ where: { id: factureId }, data: { statut: 'PAYEE' } });
      }

      await this.audit.enregistrer(tx, {
        action: 'facture.paiement_enregistre',
        entite: 'PaiementFournisseur',
        entiteId: paiement.id,
        donnees: {
          operationId,
          factureId,
          montant: donnees.montant,
          cumulPaye,
          du,
          soldee: solde,
        },
      });

      return { paiement, cumulPaye, soldee: solde };
    });
  }
}
