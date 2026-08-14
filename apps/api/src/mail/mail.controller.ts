import { Body, Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body.pipe';
import { Roles } from '../auth/decorators';
import { loadEnv } from '../config/env';
import { MailService } from './mail.service';

const testSchema = z.object({
  /** Destinataire *prévu* : c'est lui qui apparaîtra en préfixe de l'objet. */
  destinatairePrevu: z.string().email(),
  objet: z.string().min(1).default('Test de routage des e-mails'),
});

@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  /** État du routage — utile pour vérifier où partent les messages. */
  @Roles('OWNER', 'ADMIN')
  @Get('configuration')
  configuration() {
    const env = loadEnv();
    return {
      environnement: env.NODE_ENV,
      transport: env.MAIL_TRANSPORT,
      expediteur: env.MAIL_FROM,
      redirectionActive: env.NODE_ENV !== 'production' && Boolean(env.MAIL_REDIRECT_TO),
      redirigeVers: env.NODE_ENV !== 'production' ? (env.MAIL_REDIRECT_TO ?? null) : null,
      smtpConfigure: Boolean(env.SMTP_HOST),
    };
  }

  /**
   * Envoi d'un message de vérification.
   *
   * Volontairement indisponible en production : cette route n'existe que pour
   * contrôler que la redirection fonctionne, pas pour envoyer du courrier.
   */
  @Roles('OWNER', 'ADMIN')
  @Post('test')
  @HttpCode(200)
  async test(@Body(new ZodBody(testSchema)) body: z.infer<typeof testSchema>) {
    if (loadEnv().NODE_ENV === 'production') {
      throw new ForbiddenException('Route de test indisponible en production.');
    }

    return this.mail.envoyer({
      to: body.destinatairePrevu,
      subject: body.objet,
      text:
        'Ceci est un message de vérification du routage des e-mails de Prometis.\n\n' +
        'Si vous le lisez, la redirection de développement fonctionne : le message était destiné ' +
        `à ${body.destinatairePrevu} et vous parvient malgré tout.`,
      html:
        '<p>Ceci est un message de vérification du routage des e-mails de Prometis.</p>' +
        '<p>Si vous le lisez, la redirection de développement fonctionne : le message était destiné ' +
        `à <strong>${body.destinatairePrevu}</strong> et vous parvient malgré tout.</p>`,
    });
  }
}
