import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type FactureType } from '@prisma/client';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';
import { StockageService } from '../stockage/stockage.service';
import { IaService } from '../ia/ia.service';
import { configFournisseur, masquer } from '../ia/fournisseur';
import { typeAccepte } from '../securite/type-fichier';
import { OcrService } from './ocr.service';
import { extraireChamps } from './extraction';
import { suggererImputation, type CandidatContrat } from './rapprochement';
import {
  SYSTEME_LECTURE,
  ancrer,
  decimal,
  lireIban,
  lireReferenceQr,
  messageLecture,
  schemaLecture,
  schemaLectureJson,
  type Lecture,
} from './lecture';
import { controler, type Rapport } from './controles';

const ZERO = new Prisma.Decimal(0);

export type Source = 'UPLOAD' | 'CAMERA' | 'EMAIL';

export interface Piece {
  nom: string;
  octets: Buffer;
}

export type ResultatDepot =
  | { fichier: string; statut: 'recue'; factureId: number }
  | { fichier: string; statut: 'doublon'; factureId: number }
  | { fichier: string; statut: 'refusee'; raison: string };

/**
 * Le contrôle des factures, de la pièce au rapport.
 *
 * Trois portes — glisser-déposer, photo, e-mail — et un seul chemin :
 * réception (octets vérifiés, empreinte, dédoublonnage, pièce conservée),
 * lecture en arrière-plan (texte local, IA Infomaniak, ancrage), rapprochement
 * du contrat, contrôle déterministe. Rien de ce qui est lu ne s'impose : la
 * lecture complète les champs vides, jamais une saisie humaine, et la facture
 * n'entre dans le fil rouge qu'après les visas.
 */
@Injectable()
export class LectureFacturesService {
  private readonly logger = new Logger(LectureFacturesService.name);

  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly stockage: StockageService,
    private readonly ia: IaService,
    private readonly ocr: OcrService,
  ) {}

  // ===================================================================
  //  Réception
  // ===================================================================

  /** Dépôt par l'interface — la personne connectée. */
  async deposer(operationId: number, pieces: Piece[], source: Source) {
    const societeId = RequestContext.requireSocieteId();
    const membershipId = RequestContext.requireWorkspace().membershipId;
    const resultats = await this.recevoir(societeId, operationId, pieces, source, {
      membershipId,
    });
    return { resultats };
  }

  /**
   * Le chemin commun à toutes les portes. `par` : le membre qui dépose, ou le
   * message e-mail dont la pièce vient.
   */
  async recevoir(
    societeId: number,
    operationId: number,
    pieces: Piece[],
    source: Source,
    par: { membershipId?: number; emailEntrant?: string },
  ): Promise<ResultatDepot[]> {
    const resultats: ResultatDepot[] = [];
    const aLire: number[] = [];

    for (const p of pieces) {
      const controle = typeAccepte(p.octets, p.nom, 'facture');
      if (!controle.ok) {
        resultats.push({ fichier: p.nom, statut: 'refusee', raison: controle.raison });
        continue;
      }
      const sha256 = createHash('sha256').update(p.octets).digest('hex');
      const existante = await this.db.runInTenant(societeId, (tx) =>
        tx.facture.findFirst({ where: { fichierSha256: sha256 }, select: { id: true } }),
      );
      if (existante) {
        resultats.push({ fichier: p.nom, statut: 'doublon', factureId: existante.id });
        continue;
      }
      let objet: { cle: string; taille: number };
      try {
        objet = await this.stockage.deposer({
          societeId,
          operationId,
          nomFichier: p.nom,
          contenu: p.octets,
        });
      } catch (e) {
        resultats.push({ fichier: p.nom, statut: 'refusee', raison: (e as Error).message });
        continue;
      }
      const facture = await this.db.runInTenant(societeId, async (tx) => {
        const operation = await tx.operation.findUnique({
          where: { id: operationId },
          select: { id: true },
        });
        if (!operation) throw new NotFoundException('Promotion introuvable.');
        const f = await tx.facture.create({
          data: {
            societeId,
            operationId,
            source,
            statut: 'EN_LECTURE',
            ocrStatut: 'EN_ATTENTE',
            fichierCle: objet.cle,
            fichierNom: p.nom,
            fichierMime: controle.type.mime,
            fichierTaille: objet.taille,
            fichierSha256: sha256,
          },
        });
        // La pièce rejoint aussi la GED : une facture est un document de la
        // promotion comme un autre, retrouvable au même endroit.
        await tx.document.create({
          data: {
            societeId,
            operationId,
            factureId: f.id,
            titre: `Facture — ${p.nom}`,
            categorie: 'FACTURE',
            fileName: p.nom,
            filePath: objet.cle,
            mimeType: controle.type.mime,
            fileSize: objet.taille,
            version: 1,
            isCourant: true,
            uploadedById: par.membershipId ?? null,
          },
        });
        await this.audit.enregistrerAutomatique(tx, societeId, {
          action: 'facture.deposee',
          entite: 'Facture',
          entiteId: f.id,
          donnees: {
            operationId,
            source,
            fichier: p.nom,
            taille: objet.taille,
            parMembre: par.membershipId ?? null,
            emailEntrant: par.emailEntrant ?? null,
          },
        });
        return f;
      });
      resultats.push({ fichier: p.nom, statut: 'recue', factureId: facture.id });
      aLire.push(facture.id);
    }

    for (const id of aLire) this.planifier(societeId, operationId, id);
    return resultats;
  }

  /**
   * La lecture ne bloque jamais la requête : elle part après la réponse. Un
   * redémarrage du serveur pendant la lecture laisse la facture « en
   * lecture » ; le bouton « Relancer la lecture » la reprend.
   */
  planifier(societeId: number, operationId: number, factureId: number) {
    setImmediate(() => {
      this.lire(societeId, operationId, factureId).catch((e) =>
        this.logger.error(`Lecture de la facture ${factureId} : ${String(e)}`),
      );
    });
  }

  async relancer(operationId: number, factureId: number) {
    const societeId = RequestContext.requireSocieteId();
    await this.db.run(async (tx) => {
      const f = await tx.facture.findFirst({
        where: { id: factureId, operationId },
        select: { fichierCle: true, statut: true },
      });
      if (!f) throw new NotFoundException('Facture introuvable.');
      if (!f.fichierCle) throw new BadRequestException('Aucune pièce à relire sur cette facture.');
      if (['VALIDEE', 'PAYEE'].includes(f.statut)) {
        throw new BadRequestException('Facture validée : elle ne se relit plus.');
      }
      await tx.facture.update({
        where: { id: factureId },
        data: { statut: 'EN_LECTURE', ocrStatut: 'EN_ATTENTE', lectureErreur: null },
      });
    });
    this.planifier(societeId, operationId, factureId);
    return { relancee: true };
  }

  async fichier(operationId: number, factureId: number) {
    const f = await this.db.run((tx) =>
      tx.facture.findFirst({
        where: { id: factureId, operationId },
        select: { fichierCle: true, fichierNom: true, fichierMime: true },
      }),
    );
    if (!f?.fichierCle) throw new NotFoundException('Aucune pièce sur cette facture.');
    return {
      nom: f.fichierNom ?? 'facture.pdf',
      mime: f.fichierMime ?? 'application/pdf',
      contenu: await this.stockage.lire(f.fichierCle),
    };
  }

  // ===================================================================
  //  Lecture
  // ===================================================================

  async lire(societeId: number, operationId: number, factureId: number) {
    const facture = await this.db.runInTenant(societeId, (tx) =>
      tx.facture.findFirst({ where: { id: factureId, operationId }, include: { lignes: true } }),
    );
    if (!facture?.fichierCle || !facture.fichierMime) return;

    try {
      const { texte, methode } = await this.ocr.texte(
        await this.stockage.lire(facture.fichierCle),
        facture.fichierMime,
      );
      if (texte.replace(/\s+/g, '').length < 20) {
        throw new BadRequestException(
          'La pièce ne contient presque pas de texte lisible. Saisissez les montants à la main.',
        );
      }

      // Lus localement, avant tout masquage : le compte bancaire n'a pas à
      // partir chez le modèle, et c'est lui que le contrôle de fraude compare.
      const local = { iban: lireIban(texte), referenceQR: lireReferenceQr(texte) };
      let lecture: Lecture;
      let modele: string;
      if (this.ia.disponible) {
        lecture = await this.ia.completerJson(societeId, 'factures.lecture', {
          systeme: SYSTEME_LECTURE,
          utilisateur: messageLecture(masquer(texte)),
          schemaJson: schemaLectureJson,
          schema: schemaLecture,
          maxTokens: 6000,
        });
        modele = configFournisseur()?.modele ?? 'ia';
      } else {
        lecture = lectureLocale(texte);
        modele = 'lecture-locale';
      }
      const ancree = ancrer(lecture, texte, modele, local);

      await this.db.runInTenant(societeId, async (tx) => {
        const candidats = await candidatsContrats(tx, operationId);
        // Un IDE lu sur la facture désigne l'entreprise mieux qu'un nom.
        let entrepriseId = facture.entrepriseId;
        if (!entrepriseId && lecture.ide) {
          const ide = lecture.ide.replace(/[^0-9]/g, '');
          const parIde =
            ide.length >= 9
              ? (
                  await tx.entreprise.findMany({
                    where: { ide: { not: null } },
                    select: { id: true, ide: true },
                  })
                ).find((x) => x.ide!.replace(/[^0-9]/g, '') === ide)
              : undefined;
          entrepriseId = parIde?.id ?? null;
        }
        const suggestion = suggererImputation(
          {
            fournisseurNom: lecture.fournisseur,
            montantHT: facture.montantHT ?? decimal(lecture.montantHT),
            texte,
            entrepriseId,
          },
          candidats,
        );
        const premiere = facture.lecture === null;
        await tx.facture.update({
          where: { id: factureId },
          data: {
            // On complète les vides ; une saisie humaine ne se réécrit pas.
            numero: facture.numero ?? lecture.numero,
            dateFacture: facture.dateFacture ?? jour(lecture.dateFacture),
            dateEcheance: facture.dateEcheance ?? jour(lecture.dateEcheance),
            type: premiere && lecture.type ? (lecture.type as FactureType) : facture.type,
            montantHT: facture.montantHT ?? decimal(lecture.montantHT),
            tvaPct: facture.tvaPct ?? decimal(lecture.tvaPct),
            montantTVA: facture.montantTVA ?? decimal(lecture.montantTVA),
            montantTTC: facture.montantTTC ?? decimal(lecture.montantTTC),
            retenueGarantie: facture.retenueGarantie ?? decimal(lecture.retenueGarantie),
            acomptesDeduits: facture.acomptesDeduits ?? decimal(lecture.acomptesDeduits),
            iban: facture.iban ?? local.iban,
            referenceQR: facture.referenceQR ?? local.referenceQR,
            entrepriseId: facture.entrepriseId ?? suggestion.entrepriseId ?? entrepriseId,
            contratId: facture.contratId ?? suggestion.contratId,
            cfcSuggereId: suggestion.cfcNodeId,
            ocrConfiance: suggestion.confiance,
            ocrTexte: texte,
            ocrStatut: 'TRAITEE',
            lectureMethode: methode,
            lectureErreur: null,
            lecture: { ...ancree, rapprochement: suggestion.motif } as never,
            statut: 'A_VALIDER',
          },
        });
        if (!facture.lignes.length && lecture.lignes.length) {
          await tx.factureLigne.createMany({
            data: lecture.lignes.map((l, i) => ({
              factureId,
              designation: l.designation,
              codeCfc: l.codeCfc,
              montant: new Prisma.Decimal(l.montant).toDecimalPlaces(2),
              ordre: i,
            })),
          });
        }
        await this.audit.enregistrerAutomatique(tx, societeId, {
          action: 'facture.lue',
          entite: 'Facture',
          entiteId: factureId,
          donnees: {
            operationId,
            methode,
            modele,
            // Des comptes, pas des valeurs : le journal n'a pas à contenir la facture.
            ancrees: Object.values(ancree.champs).filter((c) => c.ancrage === 'ancree').length,
            proposees: Object.values(ancree.champs).filter((c) => c.ancrage === 'proposee').length,
            lignes: lecture.lignes.length,
            confianceContrat: suggestion.confiance.toString(),
          },
        });
      });
      await this.controlerEtEnregistrer(societeId, operationId, factureId);
    } catch (e) {
      const message =
        e instanceof HttpException
          ? e.message
          : 'La lecture a échoué. Relancez-la, ou saisissez les montants.';
      this.logger.error(`Lecture de la facture ${factureId} : ${String(e)}`);
      await this.db.runInTenant(societeId, (tx) =>
        tx.facture.update({
          where: { id: factureId },
          data: { ocrStatut: 'ECHOUEE', lectureErreur: message.slice(0, 500), statut: 'RECUE' },
        }),
      );
    }
  }

  // ===================================================================
  //  Contrôle
  // ===================================================================

  /** Recalcule et enregistre le rapport — après lecture, après chaque correction. */
  async recontroler(operationId: number, factureId: number): Promise<Rapport> {
    return this.controlerEtEnregistrer(RequestContext.requireSocieteId(), operationId, factureId);
  }

  async controlerEtEnregistrer(
    societeId: number,
    operationId: number,
    factureId: number,
  ): Promise<Rapport> {
    return this.db.runInTenant(societeId, async (tx) => {
      const f = await tx.facture.findFirst({
        where: { id: factureId, operationId },
        include: {
          lignes: { orderBy: { ordre: 'asc' } },
          entreprise: { select: { nom: true } },
          contrat: {
            include: {
              cfcNode: { select: { id: true, code: true, libelle: true } },
              avenants: { select: { montant: true, cfcNodeId: true } },
              entreprise: { select: { nom: true } },
            },
          },
        },
      });
      if (!f) throw new NotFoundException('Facture introuvable.');

      const noeuds = await tx.cfcNode.findMany({
        where: { operationId },
        select: { id: true, code: true, parentId: true },
      });
      const sousArbre = (racine: number) => {
        const ids = new Set([racine]);
        let ajout = true;
        while (ajout) {
          ajout = false;
          for (const n of noeuds) {
            if (n.parentId !== null && ids.has(n.parentId) && !ids.has(n.id)) {
              ids.add(n.id);
              ajout = true;
            }
          }
        }
        return ids;
      };

      let contrat = null;
      let budgetPoste: Prisma.Decimal | null = null;
      if (f.contrat) {
        const k = f.contrat;
        const racines = [k.cfcNodeId, ...k.avenants.map((a) => a.cfcNodeId)].filter(
          (x): x is number => x !== null,
        );
        const perimetreIds = new Set(racines.flatMap((r) => [...sousArbre(r)]));
        const perimetre = noeuds.filter((n) => perimetreIds.has(n.id)).map((n) => n.code);
        const autres = await tx.facture.findMany({
          where: { contratId: k.id, id: { not: factureId } },
          select: { statut: true, montantHT: true },
        });
        const somme = (xs: typeof autres) =>
          xs.reduce<Prisma.Decimal>((t, x) => t.plus(x.montantHT ?? 0), ZERO);
        const attente = autres.filter((x) =>
          ['RECUE', 'EN_LECTURE', 'A_VALIDER'].includes(x.statut),
        );
        contrat = {
          reference: k.reference,
          montant: k.montant,
          avenants: k.avenants.reduce<Prisma.Decimal>((t, a) => t.plus(a.montant), ZERO),
          retenueGarantiePct: k.retenueGarantiePct,
          cfc: k.cfcNode ? { code: k.cfcNode.code, libelle: k.cfcNode.libelle } : null,
          perimetre,
          dejaFacture: somme(autres.filter((x) => ['VALIDEE', 'PAYEE'].includes(x.statut))),
          enAttente: { nombre: attente.length, montant: somme(attente) },
        };
        if (k.cfcNodeId) {
          const lignes = await tx.ligneBudget.findMany({
            where: {
              cfcNodeId: { in: [...sousArbre(k.cfcNodeId)] },
              budgetVersion: { operationId, isCourant: true },
            },
            select: { montant: true },
          });
          budgetPoste = lignes.length
            ? lignes.reduce<Prisma.Decimal>((t, l) => t.plus(l.montant), ZERO)
            : null;
        }
      }

      // Qui couvre quel poste : pour dire « il relève du CFC 221, couvert par… ».
      const contrats = await tx.contrat.findMany({
        where: { operationId, cfcNodeId: { not: null } },
        select: { cfcNodeId: true, entreprise: { select: { nom: true } } },
      });
      const couvertPar = new Map<number, string>();
      for (const k of contrats) {
        for (const id of sousArbre(k.cfcNodeId!)) couvertPar.set(id, k.entreprise.nom);
      }
      const arbre = noeuds.map((n) => ({ code: n.code, contrat: couvertPar.get(n.id) ?? null }));

      const [ibans, doublons] = f.entrepriseId
        ? await Promise.all([
            tx.facture.findMany({
              where: {
                entrepriseId: f.entrepriseId,
                id: { not: factureId },
                iban: { not: null },
                statut: { in: ['VALIDEE', 'PAYEE'] },
              },
              select: { iban: true },
              distinct: ['iban'],
            }),
            f.numero
              ? tx.facture.findMany({
                  where: {
                    entrepriseId: f.entrepriseId,
                    numero: f.numero,
                    id: { not: factureId },
                    statut: { not: 'REJETEE' },
                  },
                  select: { id: true, operation: { select: { nom: true } } },
                })
              : Promise.resolve([]),
          ])
        : [[], []];

      const rapport = controler({
        facture: {
          numero: f.numero,
          type: f.type,
          dateFacture: f.dateFacture,
          montantHT: f.montantHT,
          tvaPct: f.tvaPct,
          montantTVA: f.montantTVA,
          montantTTC: f.montantTTC,
          retenueGarantie: f.retenueGarantie,
          acomptesDeduits: f.acomptesDeduits,
          iban: f.iban,
          lignes: f.lignes.map((l) => ({
            designation: l.designation,
            codeCfc: l.codeCfc,
            montant: l.montant,
          })),
        },
        entreprise: f.entreprise ?? (f.contrat ? f.contrat.entreprise : null),
        contrat,
        confianceContrat: f.ocrConfiance ? Number(f.ocrConfiance) : null,
        budgetPoste,
        arbre,
        ibansConnus: ibans.map((x) => x.iban!),
        doublons: doublons.map((d) => ({ id: d.id, operation: d.operation.nom })),
      });

      await tx.facture.update({
        where: { id: factureId },
        data: { controles: rapport as never, controleLe: new Date() },
      });
      return rapport;
    });
  }

  // ===================================================================
  //  Visa de la direction des travaux
  // ===================================================================

  /**
   * La direction des travaux vise — ou refuse — la facture. Elle seule, et
   * seulement là où elle est nommée. Un refus met la facture en litige, avec
   * son motif ; le promoteur ne peut pas valider sans visa favorable.
   */
  async viserDirectionTravaux(
    operationId: number,
    factureId: number,
    decision: 'APPROUVE' | 'REFUSE',
    commentaire: string | null,
  ) {
    const membershipId = RequestContext.requireWorkspace().membershipId;
    return this.db.run(async (tx) => {
      const op = await tx.operation.findUnique({
        where: { id: operationId },
        select: { directionTravauxId: true },
      });
      if (!op?.directionTravauxId) {
        throw new BadRequestException(
          'Aucune direction des travaux n’est nommée sur cette promotion.',
        );
      }
      if (op.directionTravauxId !== membershipId) {
        throw new ForbiddenException('Seule la direction des travaux nommée vise les factures.');
      }
      const f = await tx.facture.findFirst({
        where: { id: factureId, operationId },
        select: { statut: true },
      });
      if (!f) throw new NotFoundException('Facture introuvable.');
      if (!['A_VALIDER', 'LITIGE'].includes(f.statut)) {
        throw new BadRequestException('Cette facture n’attend pas de visa.');
      }
      if (decision === 'REFUSE' && !commentaire?.trim()) {
        throw new BadRequestException('Un refus s’explique : indiquez ce qui ne va pas.');
      }
      const visa = await tx.factureVisa.create({
        data: { factureId, etape: 'DIRECTION_TRAVAUX', decision, parId: membershipId, commentaire },
      });
      await tx.facture.update({
        where: { id: factureId },
        data: { statut: decision === 'REFUSE' ? 'LITIGE' : 'A_VALIDER' },
      });
      await this.audit.enregistrer(tx, {
        action: decision === 'APPROUVE' ? 'facture.visee_dt' : 'facture.refusee_dt',
        entite: 'Facture',
        entiteId: factureId,
        donnees: { operationId, commentaire },
      });
      return visa;
    });
  }
}

// ===================================================================

function jour(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

/** Sans IA : la lecture par motifs du Lot 5, dans la même forme. */
function lectureLocale(texte: string): Lecture {
  const c = extraireChamps(texte);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const n = (d: Prisma.Decimal | null) => (d ? Number(d.toString()) : null);
  return {
    fournisseur: c.fournisseurNom,
    ide: null,
    numero: c.numero,
    dateFacture: iso(c.dateFacture),
    dateEcheance: null,
    type: null,
    montantHT: n(c.montantHT),
    tvaPct: n(c.tvaPct),
    montantTVA: null,
    montantTTC: n(c.montantTTC),
    retenueGarantie: null,
    retenueGarantiePct: null,
    acomptesDeduits: null,
    referenceContrat: null,
    lignes: [],
  };
}

/** Contrats de l'opération, avec commandé et déjà-facturé — base du rapprochement. */
async function candidatsContrats(tx: TenantDb, operationId: number): Promise<CandidatContrat[]> {
  const contrats = await tx.contrat.findMany({
    where: { operationId },
    select: {
      id: true,
      reference: true,
      montant: true,
      cfcNodeId: true,
      entreprise: { select: { id: true, nom: true } },
      avenants: { select: { montant: true } },
      factures: { where: { statut: { in: ['VALIDEE', 'PAYEE'] } }, select: { montantHT: true } },
    },
  });
  return contrats.map((c) => ({
    contratId: c.id,
    reference: c.reference,
    entrepriseId: c.entreprise.id,
    entrepriseNom: c.entreprise.nom,
    cfcNodeId: c.cfcNodeId,
    montantCommande: c.avenants.reduce<Prisma.Decimal>((t, a) => t.plus(a.montant), c.montant),
    dejaFacture: c.factures.reduce<Prisma.Decimal>((t, f) => t.plus(f.montantHT ?? 0), ZERO),
  }));
}
