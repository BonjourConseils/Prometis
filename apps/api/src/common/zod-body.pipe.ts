import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validation des corps de requête par zod.
 *
 * Remplace la `ValidationPipe` de NestJS, qui repose sur class-validator :
 * la convention du projet est zod, et deux bibliothèques de validation
 * signifieraient deux endroits où chercher une règle.
 */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Corps de requête invalide.',
        details: result.error.issues.map((i) => ({
          champ: i.path.join('.') || '(racine)',
          probleme: i.message,
        })),
      });
    }
    return result.data;
  }
}
