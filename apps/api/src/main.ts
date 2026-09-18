import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadEnv, loadRootEnv } from './config/env';
import { entetesApi } from './securite/entetes';

async function bootstrap(): Promise<void> {
  loadRootEnv();
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  // `rawBody` conserve les octets reçus à côté du corps analysé. C'est
  // indispensable aux webhooks Kolabimo : la signature HMAC porte sur le texte
  // exact envoyé, et re-sérialiser l'objet donnerait une autre empreinte.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });

  // En-têtes de sécurité sur toute réponse, et plus de `X-Powered-By` : dire
  // quel framework répond n'aide que celui qui cherche la faille qui va avec.
  const entetes = entetesApi(env.NODE_ENV === 'production');
  const express = app.getHttpAdapter().getInstance() as {
    disable: (nom: string) => void;
    use: (
      fn: (
        req: unknown,
        res: { setHeader: (n: string, v: string) => void },
        next: () => void,
      ) => void,
    ) => void;
  };
  express.disable('x-powered-by');
  express.use((_req, res, next) => {
    for (const [nom, valeur] of Object.entries(entetes)) res.setHeader(nom, valeur);
    next();
  });
  // Pas de `ValidationPipe` de Nest : elle repose sur class-validator, alors
  // que la convention du projet est zod (cf. CLAUDE.md §9). Le premier lot qui
  // introduit un corps de requête ajoutera un pipe zod dédié — pas une
  // seconde bibliothèque de validation.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  logger.log(`API Prometis à l'écoute sur http://localhost:${env.API_PORT}`);
}

void bootstrap();
