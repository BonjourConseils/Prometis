import { Global, Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

/**
 * Global : `MailService` est le seul point d'envoi de l'application, il doit
 * être injectable partout sans réimporter le module.
 */
@Global()
@Module({
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
