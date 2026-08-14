import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv, type Env } from '../config/env';
import { appliquerRedirection, type Message } from './redirection';

export type { Message } from './redirection';

export interface ResultatEnvoi {
  /** Adresse réellement servie — celle de redirection hors production. */
  destinataireReel: string | string[];
  destinatairePrevu: string | string[];
  objet: string;
  redirige: boolean;
  transport: Env['MAIL_TRANSPORT'];
}

/**
 * **Le** point d'envoi d'e-mail de l'application.
 *
 * Toute communication sortante — appel de fonds, relance, invitation, partage
 * de document — passe par `envoyer()`. Rien d'autre ne doit parler à un
 * transport SMTP : c'est la seule façon de garantir qu'aucun message ne parte
 * chez un vrai acquéreur pendant le développement.
 *
 * Garde-fou : hors production, si `MAIL_REDIRECT_TO` n'est pas configurée,
 * l'envoi est **refusé**. Mieux vaut une erreur visible qu'un appel de fonds
 * expédié par erreur à un vrai client.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly env = loadEnv();
  private transporter?: Transporter;

  private get estProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  private get redirigerVers(): string | undefined {
    // La redirection ne s'applique jamais en production : là, les messages
    // doivent atteindre leurs vrais destinataires.
    return this.estProduction ? undefined : this.env.MAIL_REDIRECT_TO;
  }

  async envoyer(message: Message): Promise<ResultatEnvoi> {
    if (!this.estProduction && !this.env.MAIL_REDIRECT_TO) {
      throw new InternalServerErrorException(
        "MAIL_REDIRECT_TO n'est pas configurée hors production. L'envoi est refusé : " +
          'sans redirection, ce message partirait à son destinataire réel.',
      );
    }

    const aEnvoyer = appliquerRedirection(message, {
      redirigerVers: this.redirigerVers,
      environnement: this.env.NODE_ENV,
    });

    const resultat: ResultatEnvoi = {
      destinataireReel: aEnvoyer.to,
      destinatairePrevu: message.to,
      objet: aEnvoyer.subject,
      redirige: this.redirigerVers !== undefined,
      transport: this.env.MAIL_TRANSPORT,
    };

    if (this.env.MAIL_TRANSPORT === 'console') {
      // Transport par défaut : aucune connexion SMTP, le message est journalisé.
      // Permet de développer et de tester sans identifiants de messagerie.
      this.logger.log(
        `[${resultat.redirige ? 'redirigé' : 'direct'}] → ${joindre(aEnvoyer.to)} · ${aEnvoyer.subject}`,
      );
      this.logger.debug(aEnvoyer.text ?? aEnvoyer.html ?? '(corps vide)');
      return resultat;
    }

    await this.transport().sendMail({
      from: this.env.MAIL_FROM,
      to: aEnvoyer.to,
      subject: aEnvoyer.subject,
      text: aEnvoyer.text,
      html: aEnvoyer.html,
      replyTo: aEnvoyer.replyTo,
    });

    this.logger.log(
      `[${resultat.redirige ? 'redirigé' : 'direct'}] → ${joindre(aEnvoyer.to)} · ${aEnvoyer.subject}`,
    );
    return resultat;
  }

  private transport(): Transporter {
    if (!this.transporter) {
      if (!this.env.SMTP_HOST) {
        throw new InternalServerErrorException(
          'MAIL_TRANSPORT=smtp mais SMTP_HOST est vide. Configurer le serveur, ou repasser en MAIL_TRANSPORT=console.',
        );
      }
      this.transporter = createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_SECURE,
        auth: this.env.SMTP_USER
          ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
          : undefined,
      });
    }
    return this.transporter;
  }
}

const joindre = (valeur: string | string[]): string =>
  Array.isArray(valeur) ? valeur.join(', ') : valeur;
