import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { loadEnv } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessService } from './access.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { AuthContextMiddleware } from './auth-context.middleware';
import { AppModuleGuard, AuthGuard, OperationAccessGuard, RolesGuard } from './guards';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_SECRET,
          signOptions: {
            // Le format a déjà été validé par zod ; le cast ne fait
            // qu'accorder le type nominal attendu par la bibliothèque.
            expiresIn: env.JWT_EXPIRES_IN as JwtSignOptions['expiresIn'],
            issuer: 'prometis',
          },
          verifyOptions: { issuer: 'prometis' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessService,
    PasswordService,
    TokenService,
    MfaService,
    AuthContextMiddleware,
    // Ordre significatif : identité, puis rôle, puis module de la société,
    // puis droit sur l'opération. Chaque étage suppose le précédent satisfait.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AppModuleGuard },
    { provide: APP_GUARD, useClass: OperationAccessGuard },
  ],
  exports: [
    AuthService,
    AccessService,
    PasswordService,
    TokenService,
    MfaService,
    AuthContextMiddleware,
  ],
})
export class AuthModule {}
