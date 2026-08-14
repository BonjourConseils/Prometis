import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadEnv, loadRootEnv } from './config/env';

async function bootstrap(): Promise<void> {
  loadRootEnv();
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  // `rawBody` conserve les octets reçus à côté du corps analysé. C'est
  // indispensable aux webhooks Kolabimo : la signature HMAC porte sur le texte
  // exact envoyé, et re-sérialiser l'objet donnerait une autre empreinte.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  // Pas de `ValidationPipe` de Nest : elle repose sur class-validator, alors
  // que la convention du projet est zod (cf. CLAUDE.md §9). Le premier lot qui
  // introduit un corps de requête ajoutera un pipe zod dédié — pas une
  // seconde bibliothèque de validation.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.log(`API Prometis à l'écoute sur http://localhost:${env.API_PORT}`);
}

void bootstrap();
