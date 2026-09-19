import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { ZodBody } from '../common/zod-body.pipe';
import { montantPositif, nombreDecimal } from '../common/zod-decimal';
import { TAILLE_MAX_OCTETS } from '../stockage/chemin';
import { EspaceEntrepriseService } from './espace-entreprise.service';

/**
 * La session de l'espace entreprise voyage dans son propre en-tête, jamais
 * dans `Authorization` : elle ne doit pas même être essayée comme une
 * session Prometis.
 */
const ENTETE_SESSION = 'x-consultation-session';

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Six chiffres.'),
});
const questionSchema = z.object({ question: z.string().trim().min(5).max(3000) });
const declinerSchema = z.object({ motif: z.string().trim().max(1000).nullish() });

/** Le dépôt arrive en multipart : les champs sont des chaînes, les lignes du JSON. */
const offreSchema = z.object({
  montant: montantPositif.refine((d) => d.greaterThan(0), 'Le montant de l’offre est requis.'),
  remisePct: nombreDecimal
    .refine((n) => n.greaterThanOrEqualTo(0) && n.lessThan(100), 'Remise entre 0 et 100 %.')
    .nullish()
    .or(z.literal('').transform(() => null)),
  note: z.string().trim().max(3000).nullish(),
  lignes: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return [];
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Options et variantes illisibles.' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(
          z.object({
            type: z.enum(['OPTION', 'VARIANTE']),
            libelle: z.string().trim().min(1).max(200),
            montant: montantPositif,
          }),
        )
        .max(30),
    ),
});

/**
 * L'espace entreprise. `@Public` : aucun compte Prometis ne l'appelle. Chaque
 * route est gardée dans le service — lien bien formé et connu, code, puis
 * session liée à ce lien et relue en base.
 */
@Controller('consultation/:jeton')
export class EspaceEntrepriseController {
  constructor(private readonly espace: EspaceEntrepriseService) {}

  @Public()
  @Post('code')
  @HttpCode(200)
  code(@Param('jeton') jeton: string) {
    return this.espace.demanderCode(jeton);
  }

  @Public()
  @Post('session')
  @HttpCode(200)
  session(
    @Param('jeton') jeton: string,
    @Body(new ZodBody(codeSchema)) body: z.infer<typeof codeSchema>,
  ) {
    return this.espace.ouvrirSession(jeton, body.code);
  }

  @Public()
  @Get()
  dossier(@Param('jeton') jeton: string, @Req() req: Request) {
    return this.espace.dossier(jeton, req.header(ENTETE_SESSION));
  }

  @Public()
  @Get('documents/:documentId')
  async document(
    @Param('jeton') jeton: string,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { document, contenu } = await this.espace.document(
      jeton,
      req.header(ENTETE_SESSION),
      documentId,
    );
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', contenu.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(contenu);
  }

  @Public()
  @Post('questions')
  poserQuestion(
    @Param('jeton') jeton: string,
    @Req() req: Request,
    @Body(new ZodBody(questionSchema)) body: z.infer<typeof questionSchema>,
  ) {
    return this.espace.poserQuestion(jeton, req.header(ENTETE_SESSION), body.question);
  }

  @Public()
  @Post('offre')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX_OCTETS } }))
  deposer(
    @Param('jeton') jeton: string,
    @Req() req: Request,
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Body(new ZodBody(offreSchema)) body: z.infer<typeof offreSchema>,
  ) {
    if (fichier && fichier.size === 0) throw new BadRequestException('Fichier vide.');
    return this.espace.deposerOffre(
      jeton,
      req.header(ENTETE_SESSION),
      {
        montant: body.montant,
        remisePct: body.remisePct ?? null,
        note: body.note ?? null,
        lignes: body.lignes,
      },
      fichier && { nomOriginal: fichier.originalname, contenu: fichier.buffer },
    );
  }

  @Public()
  @Post('decliner')
  @HttpCode(200)
  decliner(
    @Param('jeton') jeton: string,
    @Req() req: Request,
    @Body(new ZodBody(declinerSchema)) body: z.infer<typeof declinerSchema>,
  ) {
    return this.espace.decliner(jeton, req.header(ENTETE_SESSION), body.motif ?? null);
  }
}
