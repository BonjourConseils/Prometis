import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService, type TenantDb } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { TRAME_CFC, type NoeudTrame } from './trame-cfc';

export interface DonneesNoeud {
  parentId?: number | null;
  code: string;
  libelle: string;
  ordre?: number;
}

@Injectable()
export class CfcService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private async noeudDeLOperation(tx: TenantDb, operationId: number, cfcNodeId: number) {
    const noeud = await tx.cfcNode.findFirst({
      where: { id: cfcNodeId, operationId },
      select: { id: true, code: true, libelle: true, niveau: true, parentId: true },
    });
    if (!noeud)
      throw new NotFoundException(`Poste CFC ${cfcNodeId} introuvable dans cette opération.`);
    return noeud;
  }

  async lister(operationId: number) {
    return this.db.run((tx) =>
      tx.cfcNode.findMany({
        where: { operationId },
        orderBy: [{ niveau: 'asc' }, { ordre: 'asc' }, { code: 'asc' }],
      }),
    );
  }

  /**
   * Crée un poste. Le niveau est **déduit du parent**, jamais fourni par
   * l'appelant : un niveau incohérent avec la hiérarchie rendrait l'arbre
   * illisible sans que rien ne le signale.
   */
  async creer(operationId: number, donnees: DonneesNoeud) {
    return this.db.run(async (tx) => {
      let niveau = 1;
      if (donnees.parentId) {
        const parent = await this.noeudDeLOperation(tx, operationId, donnees.parentId);
        niveau = parent.niveau + 1;
      }

      const doublon = await tx.cfcNode.findFirst({
        where: { operationId, code: donnees.code },
        select: { id: true },
      });
      if (doublon) {
        throw new BadRequestException(
          `Le code CFC « ${donnees.code} » existe déjà dans cette opération.`,
        );
      }

      const noeud = await tx.cfcNode.create({
        data: {
          operationId,
          parentId: donnees.parentId ?? null,
          code: donnees.code,
          libelle: donnees.libelle,
          niveau,
          ordre: donnees.ordre ?? 0,
        },
      });

      await this.audit.enregistrer(tx, {
        action: 'cfc.cree',
        entite: 'CfcNode',
        entiteId: noeud.id,
        donnees: { operationId, code: noeud.code, libelle: noeud.libelle },
      });
      return noeud;
    });
  }

  async modifier(operationId: number, cfcNodeId: number, donnees: Partial<DonneesNoeud>) {
    return this.db.run(async (tx) => {
      const avant = await this.noeudDeLOperation(tx, operationId, cfcNodeId);

      if (donnees.code && donnees.code !== avant.code) {
        const doublon = await tx.cfcNode.findFirst({
          where: { operationId, code: donnees.code, NOT: { id: cfcNodeId } },
          select: { id: true },
        });
        if (doublon) {
          throw new BadRequestException(`Le code CFC « ${donnees.code} » existe déjà.`);
        }
      }

      // Le déplacement d'un poste (changement de parent) n'est pas exposé :
      // il faudrait recalculer le niveau de toute la descendance, et un arbre
      // à moitié déplacé est pire qu'un arbre figé. À rouvrir si le besoin
      // apparaît, avec la mise à jour récursive.
      const { parentId: _ignore, ...modifiables } = donnees;

      const noeud = await tx.cfcNode.update({ where: { id: cfcNodeId }, data: modifiables });
      await this.audit.enregistrer(tx, {
        action: 'cfc.modifie',
        entite: 'CfcNode',
        entiteId: cfcNodeId,
        donnees: { operationId, avant: avant.code, champs: Object.keys(modifiables) },
      });
      return noeud;
    });
  }

  /**
   * Supprime un poste, à condition que rien n'y soit rattaché.
   *
   * Supprimer un poste portant des lignes de budget, une soumission ou une
   * facture ferait disparaître des montants du fil rouge sans laisser de
   * trace. On refuse, en disant précisément ce qui bloque.
   */
  async supprimer(operationId: number, cfcNodeId: number) {
    return this.db.run(async (tx) => {
      const noeud = await this.noeudDeLOperation(tx, operationId, cfcNodeId);

      const [enfants, lignes, soumissions, contrats, factures, avenants] = await Promise.all([
        tx.cfcNode.count({ where: { parentId: cfcNodeId } }),
        tx.ligneBudget.count({ where: { cfcNodeId } }),
        tx.soumission.count({ where: { cfcNodeId } }),
        tx.contrat.count({ where: { cfcNodeId } }),
        tx.facture.count({ where: { cfcNodeId } }),
        tx.avenant.count({ where: { cfcNodeId } }),
      ]);

      const blocages = [
        enfants && `${enfants} sous-poste(s)`,
        lignes && `${lignes} ligne(s) de budget`,
        soumissions && `${soumissions} soumission(s)`,
        contrats && `${contrats} contrat(s)`,
        factures && `${factures} facture(s)`,
        avenants && `${avenants} avenant(s)`,
      ].filter(Boolean);

      if (blocages.length > 0) {
        throw new BadRequestException(
          `Le poste ${noeud.code} ne peut pas être supprimé : ${blocages.join(', ')} y sont rattachés.`,
        );
      }

      await tx.cfcNode.delete({ where: { id: cfcNodeId } });
      await this.audit.enregistrer(tx, {
        action: 'cfc.supprime',
        entite: 'CfcNode',
        entiteId: cfcNodeId,
        donnees: { operationId, code: noeud.code },
      });
      return { supprime: true };
    });
  }

  /**
   * Importe la trame CFC de départ.
   *
   * Refuse si l'arbre contient déjà quelque chose : fusionner une trame avec
   * un arbre existant produirait des doublons de codes et des niveaux
   * incohérents. Repartir d'une opération vide est explicite ; une fusion
   * silencieuse ne l'est pas.
   */
  async importerTrame(operationId: number) {
    return this.db.run(async (tx) => {
      const existants = await tx.cfcNode.count({ where: { operationId } });
      if (existants > 0) {
        throw new BadRequestException(
          `L'arborescence CFC contient déjà ${existants} postes. ` +
            'La trame ne peut être importée que dans une opération sans arbre CFC.',
        );
      }

      let crees = 0;
      const inserer = async (
        spec: NoeudTrame,
        parentId: number | null,
        niveau: number,
        ordre: number,
      ) => {
        const noeud = await tx.cfcNode.create({
          data: { operationId, parentId, code: spec.code, libelle: spec.libelle, niveau, ordre },
        });
        crees += 1;
        let i = 0;
        for (const enfant of spec.enfants ?? []) {
          await inserer(enfant, noeud.id, niveau + 1, i++);
        }
      };

      let i = 0;
      for (const racine of TRAME_CFC) {
        await inserer(racine, null, 1, i++);
      }

      await this.audit.enregistrer(tx, {
        action: 'cfc.trame_importee',
        entite: 'Operation',
        entiteId: operationId,
        donnees: { postesCrees: crees },
      });

      return { postesCrees: crees };
    });
  }
}
