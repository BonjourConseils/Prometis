import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { nombreDecimal } from '../common/zod-decimal';
import { Roles } from '../auth/decorators';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';
import { AuditService } from '../audit/audit.service';

/** Les 26 cantons, plus rien : un sigle libre laisserait passer « Valais ». */
const CANTONS = [
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
] as const;

const tauxSchema = z.object({
  /**
   * Un taux, pas un montant : 3 pour « 3 % ». Borné à 20 — au-delà, c'est une
   * erreur de saisie, pas un canton cher.
   */
  pourcentage: nombreDecimal.refine((v) => v.greaterThan(0) && v.lessThanOrEqualTo(20), {
    message: 'Le taux doit être compris entre 0 et 20 %.',
  }),
  note: z.string().trim().max(300).nullish(),
});

/**
 * Taux de frais d'acquisition par canton.
 *
 * Paramétrage de société, réservé à l'administration : ces taux servent à
 * estimer les frais d'une promotion tant qu'ils ne sont pas connus. Aucun
 * barème n'est livré par défaut — les pratiques varient d'un notaire à
 * l'autre, et un chiffre inventé ici se retrouverait dans un bilan.
 */
@Controller('taux-acquisition')
export class TauxAcquisitionController {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  lister() {
    return this.db.run((tx) => tx.tauxFraisAcquisition.findMany({ orderBy: { canton: 'asc' } }));
  }

  /** `PUT` et non `POST` : un canton n'a qu'un taux, on le pose ou on le remplace. */
  @Roles('OWNER', 'ADMIN')
  @Put(':canton')
  async definir(
    @Param('canton') canton: string,
    @Body(new ZodBody(tauxSchema)) body: z.infer<typeof tauxSchema>,
  ) {
    const societeId = RequestContext.requireSocieteId();

    // `parse` lèverait une ZodError brute, que Nest rendrait en 500 : un
    // sigle inconnu est une erreur de la requête, pas du serveur.
    const sigle = z.enum(CANTONS).safeParse(canton.toUpperCase());
    if (!sigle.success) {
      throw new BadRequestException(`« ${canton} » n'est pas un sigle de canton suisse.`);
    }

    return this.db.run(async (tx) => {
      const taux = await tx.tauxFraisAcquisition.upsert({
        where: { societeId_canton: { societeId, canton: sigle.data } },
        create: { societeId, canton: sigle.data, ...body },
        update: body,
      });
      await this.audit.enregistrer(tx, {
        action: 'taux_acquisition.defini',
        entite: 'TauxFraisAcquisition',
        entiteId: taux.id,
        donnees: { canton: sigle.data, pourcentage: taux.pourcentage.toFixed(2) },
      });
      return taux;
    });
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  async supprimer(@Param('id', ParseIntPipe) id: number) {
    return this.db.run(async (tx) => {
      const taux = await tx.tauxFraisAcquisition.findUnique({ where: { id } });
      if (!taux) return { supprime: false };

      await tx.tauxFraisAcquisition.delete({ where: { id } });
      await this.audit.enregistrer(tx, {
        action: 'taux_acquisition.supprime',
        entite: 'TauxFraisAcquisition',
        entiteId: id,
        donnees: { canton: taux.canton },
      });
      return { supprime: true };
    });
  }
}
