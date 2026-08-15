import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { TAILLE_MAX_OCTETS } from '../stockage/chemin';
import { ZodBody } from '../common/zod-body.pipe';
import { montant, montantPositif, nombreDecimal } from '../common/zod-decimal';
import { RequireModule, RequireOperationAccess, Roles } from '../auth/decorators';
import { FacturesService } from './factures.service';

const texteOptionnel = z.string().trim().min(1).max(2000).nullish();

const STATUTS = [
  'RECUE',
  'EN_LECTURE',
  'A_VALIDER',
  'VALIDEE',
  'PAYEE',
  'LITIGE',
  'REJETEE',
] as const;

const factureSchema = z.object({
  contratId: z.number().int().positive().nullish(),
  entrepriseId: z.number().int().positive().nullish(),
  cfcNodeId: z.number().int().positive().nullish(),
  // Valeurs de `FactureType` au schéma, ni plus ni moins.
  type: z.enum(['SITUATION', 'ACOMPTE', 'SOLDE', 'AVOIR']).optional(),
  numero: z.string().trim().min(1).max(60).nullish(),
  dateFacture: z.coerce.date().nullish(),
  // Un avoir est négatif : `montant` et non `montantPositif`.
  montantHT: montant.nullish(),
  tvaPct: nombreDecimal.nullish(),
  montantTTC: montant.nullish(),
  fichierUrl: z.string().trim().max(500).nullish(),
  ocrTexte: z.string().max(50_000).nullish(),
});

const validerSchema = z.object({
  cfcNodeId: z.number().int().positive().nullish(),
  contratId: z.number().int().positive().nullish(),
  /** Passer outre un dépassement du commandé — tracé dans l'audit. */
  forcer: z.boolean().optional(),
});

const statutSchema = z.object({
  statut: z.enum(['LITIGE', 'REJETEE', 'A_VALIDER']),
  motif: z
    .string()
    .trim()
    .min(3, 'Un motif est requis : sans lui, la trace ne sert à rien.')
    .max(500),
});

const paiementSchema = z.object({
  montant: montantPositif,
  dateValeur: z.coerce.date(),
  moyen: z.string().trim().max(60).nullish(),
  reference: texteOptionnel,
});

/** Factures fournisseurs d'une opération. */
@RequireModule('FACTURES')
@Controller('operations/:operationId/factures')
export class FacturesController {
  constructor(private readonly factures: FacturesService) {}

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get()
  lister(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Query('statut') statut?: string,
  ) {
    const filtre = STATUTS.find((s) => s === statut);
    return this.factures.lister(operationId, filtre);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post()
  creer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Body(new ZodBody(factureSchema)) body: z.infer<typeof factureSchema>,
  ) {
    return this.factures.creer(operationId, body);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Patch(':factureId')
  modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(factureSchema.partial())) body: Partial<z.infer<typeof factureSchema>>,
  ) {
    return this.factures.modifier(operationId, factureId, body);
  }

  /**
   * Dépose le PDF de la facture, en extrait le texte, puis analyse.
   *
   * L'extraction tourne sur le serveur : aucune donnée de fournisseur ne
   * part chez un prestataire.
   */
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/pdf')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  deposerPdf(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @UploadedFile() fichier: Express.Multer.File | undefined,
  ) {
    if (!fichier) {
      throw new BadRequestException(
        'Aucun fichier reçu. Envoyer un formulaire multipart avec un champ « fichier ».',
      );
    }
    return this.factures.extraireDepuisPdf(operationId, factureId, fichier.buffer);
  }

  /** Lecture des champs et proposition d'imputation CFC. */
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/analyser')
  @HttpCode(200)
  analyser(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
  ) {
    return this.factures.analyser(operationId, factureId);
  }

  /** Contrôle « facturé cumulé ≤ commandé », sans rien modifier. */
  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get(':factureId/controle')
  controler(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
  ) {
    return this.factures.controler(operationId, factureId);
  }

  /**
   * Validation humaine — le seul chemin vers la colonne « facturé ».
   *
   * Le schéma ne porte qu'un validateur (`validePar`) : le circuit à plusieurs
   * niveaux du plan est ici assuré par les rôles et les statuts, et tracé
   * transition par transition dans `AuditLog`. Un registre formel de plusieurs
   * approbateurs par facture demanderait une extension du modèle.
   */
  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/validation')
  @HttpCode(200)
  valider(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(validerSchema)) body: z.infer<typeof validerSchema>,
  ) {
    return this.factures.valider(operationId, factureId, body);
  }

  @Roles('OWNER', 'ADMIN', 'CHEF_PROJET', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/statut')
  @HttpCode(200)
  changerStatut(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(statutSchema)) body: z.infer<typeof statutSchema>,
  ) {
    return this.factures.changerStatut(operationId, factureId, body.statut, body.motif);
  }

  // Régler une facture est un geste de comptabilité, pas de saisie courante.
  @Roles('OWNER', 'ADMIN', 'COMPTABILITE')
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/paiements')
  enregistrerPaiement(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(paiementSchema)) body: z.infer<typeof paiementSchema>,
  ) {
    return this.factures.enregistrerPaiement(operationId, factureId, body);
  }
}
