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
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { LectureFacturesService } from './lecture-factures.service';
import { typeAccepte } from '../securite/type-fichier';
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
  montantTVA: montant.nullish(),
  retenueGarantie: montantPositif.nullish(),
  acomptesDeduits: montantPositif.nullish(),
  dateEcheance: z.coerce.date().nullish(),
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), 'IBAN invalide.')
    .nullish(),
});

const depotSchema = z.object({ source: z.enum(['UPLOAD', 'CAMERA']).default('UPLOAD') });

const lignesSchema = z.object({
  lignes: z
    .array(
      z.object({
        designation: z.string().trim().min(1).max(300),
        codeCfc: z.string().trim().max(20).nullish(),
        montant,
      }),
    )
    .max(80),
});

const visaSchema = z.object({
  decision: z.enum(['APPROUVE', 'REFUSE']),
  commentaire: z.string().trim().max(2000).nullish(),
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
  constructor(
    private readonly factures: FacturesService,
    private readonly lecture: LectureFacturesService,
  ) {}

  /**
   * Déposer une ou plusieurs factures — fichiers, ou photos prises au
   * téléphone. La lecture part après la réponse ; chaque pièce dit ce qu'elle
   * est devenue (reçue, doublon, refusée).
   */
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post('depots')
  @HttpCode(200)
  @UseInterceptors(FilesInterceptor('fichiers', 20, { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  deposer(
    @Param('operationId', ParseIntPipe) operationId: number,
    @UploadedFiles() fichiers: Express.Multer.File[] | undefined,
    @Body(new ZodBody(depotSchema)) body: z.infer<typeof depotSchema>,
  ) {
    if (!fichiers?.length) throw new BadRequestException('Aucun fichier reçu.');
    return this.lecture.deposer(
      operationId,
      fichiers.map((f) => ({ nom: f.originalname, octets: f.buffer })),
      body.source,
    );
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get(':factureId')
  detail(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
  ) {
    return this.factures.detail(operationId, factureId);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Get(':factureId/fichier')
  async fichier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.lecture.fichier(operationId, factureId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', f.contenu.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.nom)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(f.contenu);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/relire')
  @HttpCode(200)
  relire(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
  ) {
    return this.lecture.relancer(operationId, factureId);
  }

  @RequireOperationAccess({ level: 'READ_ONLY', module: 'FACTURES' })
  @Post(':factureId/recontroler')
  @HttpCode(200)
  recontroler(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
  ) {
    return this.lecture.recontroler(operationId, factureId);
  }

  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Put(':factureId/lignes')
  async fixerLignes(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(lignesSchema)) body: z.infer<typeof lignesSchema>,
  ) {
    await this.factures.fixerLignes(operationId, factureId, body.lignes);
    return this.lecture.recontroler(operationId, factureId);
  }

  /** Le visa de la direction des travaux — elle seule, là où elle est nommée. */
  @RequireOperationAccess({ level: 'OPERATE', module: 'FACTURES' })
  @Post(':factureId/visa-direction-travaux')
  @HttpCode(200)
  viser(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(visaSchema)) body: z.infer<typeof visaSchema>,
  ) {
    return this.lecture.viserDirectionTravaux(
      operationId,
      factureId,
      body.decision,
      body.commentaire ?? null,
    );
  }

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
  async modifier(
    @Param('operationId', ParseIntPipe) operationId: number,
    @Param('factureId', ParseIntPipe) factureId: number,
    @Body(new ZodBody(factureSchema.partial())) body: Partial<z.infer<typeof factureSchema>>,
  ) {
    const facture = await this.factures.modifier(operationId, factureId, body);
    // Une correction humaine relance le contrôle : le rapport suit les chiffres.
    await this.lecture.recontroler(operationId, factureId);
    return facture;
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
    // Les octets, pas le type annoncé par le navigateur : c'est ce fichier
    // qui part dans l'extracteur du serveur.
    const controle = typeAccepte(fichier.buffer, fichier.originalname, 'facture');
    if (!controle.ok) throw new BadRequestException(controle.raison);
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
   * C'est l'approbation du promoteur. Quand l'opération a nommé une direction
   * des travaux, son visa favorable la précède (`facture_visas`) ; la
   * comptabilité règle ensuite.
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
