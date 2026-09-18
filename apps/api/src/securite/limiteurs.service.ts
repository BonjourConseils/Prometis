import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContext } from '../context/request-context';
import { Limiteur, REGLES, minutes, type Verdict } from './limiteur';

export type EvenementConnexion =
  'CONNEXION_REUSSIE' | 'ECHEC_MOT_DE_PASSE' | 'ECHEC_MFA' | 'MFA_REUSSI' | 'BLOQUE';

/**
 * Les limiteurs de l'instance, et le journal des connexions.
 *
 * Un seul service, instancié une fois : trois limiteurs créés à plusieurs
 * endroits compteraient chacun de leur côté, et aucun n'atteindrait jamais
 * son seuil.
 */
@Injectable()
export class LimiteursService {
  private readonly logger = new Logger(LimiteursService.name);

  readonly compte = new Limiteur(REGLES.compte);
  readonly adresse = new Limiteur(REGLES.adresse);
  readonly mfa = new Limiteur(REGLES.mfa);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refuse si le verdict l'exige.
   *
   * Même message quelle que soit la raison — compte, adresse ou code : dire
   * laquelle des barrières a cédé renseignerait surtout celui qui les essaie.
   */
  exiger(verdict: Verdict): void {
    if (verdict.autorise) return;
    throw new HttpException(
      `Trop de tentatives. Réessayez dans ${minutes(verdict.reessayerDansMs)} minute(s).`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Clé d'adresse de la requête en cours. */
  cleAdresse(): string {
    return `ip:${RequestContext.origine().ip ?? 'inconnue'}`;
  }

  /**
   * Inscrit un événement de connexion. Ne lève jamais : un journal en panne
   * ne doit pas empêcher quelqu'un de se connecter — mais il doit se voir.
   */
  async journaliser(compteId: number | null, evenement: EvenementConnexion): Promise<void> {
    const { ip, userAgent } = RequestContext.origine();
    try {
      await this.prisma.journalConnexion.create({ data: { compteId, evenement, ip, userAgent } });
    } catch (erreur) {
      this.logger.error(`Journal des connexions non écrit (${evenement}) : ${String(erreur)}`);
    }
  }
}
