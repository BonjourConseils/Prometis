import { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Montant en CHF, accepté en nombre ou en chaîne, converti en `Prisma.Decimal`.
 *
 * La chaîne est la forme sûre : un montant transporté en JSON comme nombre
 * flottant a déjà perdu de la précision avant d'arriver ici. Le front doit
 * envoyer `"1250000.50"`, pas `1250000.5`.
 */
export const montant = z
  .union([z.number(), z.string()])
  .refine(
    (v) => {
      try {
        const d = new Prisma.Decimal(v);
        return d.isFinite();
      } catch {
        return false;
      }
    },
    { message: 'Montant invalide.' },
  )
  .transform((v) => new Prisma.Decimal(v));

/** Nombre décimal générique (surface, quote-part, pourcentage). */
export const nombreDecimal = montant;

/** Montant positif ou nul — un prix de vente négatif est une faute de saisie. */
export const montantPositif = montant.refine((d) => d.greaterThanOrEqualTo(0), {
  message: 'Le montant ne peut pas être négatif.',
});
