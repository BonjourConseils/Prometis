import {
  Controller,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { FacturationModule } from '../facturation/facturation.module';
import { FacturationService } from '../facturation/facturation.service';
import { SoumissionsModule } from '../soumissions/soumissions.module';
import { ConsultationService } from '../soumissions/consultation.service';

const env = loadEnv();

/**
 * La passe quotidienne : ce qui doit partir un jour donné sans qu'un
 * humain clique — l'avertissement de fin d'essai (J-3), la relance des
 * entreprises qui n'ont pas répondu (J-3).
 *
 * Elle échoue en silence si on la laisse faire : chaque exécution laisse donc
 * une trace en base (`passes_quotidiennes`), lisible dans l'espace
 * exploitant. Une tâche qui échoue n'empêche pas les autres de tourner.
 */
@Injectable()
export class PasseQuotidienneService {
  private readonly logger = new Logger(PasseQuotidienneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facturation: FacturationService,
    private readonly consultation: ConsultationService,
  ) {}

  async executer() {
    const trace = await this.prisma.passeQuotidienne.create({ data: {} });
    const erreurs: string[] = [];
    const resultat: Record<string, number> = {};
    const taches: [string, () => Promise<number>][] = [
      ['finsEssai', () => this.facturation.avertirFinsEssai()],
      ['relancesSoumissions', () => this.consultation.relancer()],
    ];
    for (const [nom, tache] of taches) {
      try {
        resultat[nom] = await tache();
      } catch (e) {
        erreurs.push(`${nom} : ${(e as Error).message}`);
        this.logger.error(`Passe quotidienne, ${nom} : ${(e as Error).message}`);
      }
    }
    const envoyes = Object.values(resultat).reduce((a, b) => a + b, 0);
    await this.prisma.passeQuotidienne.update({
      where: { id: trace.id },
      data: {
        fin: new Date(),
        envoyes,
        erreur: erreurs.length ? erreurs.join(' · ').slice(0, 500) : null,
      },
    });
    return { passe: trace.id, ...resultat, erreurs };
  }
}

function egal(a: string, b: string): boolean {
  const ta = Buffer.from(a);
  const tb = Buffer.from(b);
  return ta.length === tb.length && timingSafeEqual(ta, tb);
}

/**
 * Appelée par le cron du serveur. Sa barrière est le secret, vérifié ici —
 * pas le nom d'hôte : le cron l'appelle par le réseau interne, et un contrôle
 * d'hôte l'aurait refusée chaque nuit sans bruit (vécu, My New Job AI).
 */
@Controller('internal')
export class PasseQuotidienneController {
  constructor(private readonly passe: PasseQuotidienneService) {}

  @Public()
  @Post('passe-quotidienne')
  @HttpCode(200)
  executer(@Req() requete: Request) {
    const recu = requete.header('x-passe-secret') ?? '';
    if (!env.PASSE_QUOTIDIENNE_SECRET || !egal(recu, env.PASSE_QUOTIDIENNE_SECRET)) {
      throw new UnauthorizedException();
    }
    return this.passe.executer();
  }
}

@Module({
  imports: [FacturationModule, SoumissionsModule],
  controllers: [PasseQuotidienneController],
  providers: [PasseQuotidienneService],
})
export class PasseQuotidienneModule {}
