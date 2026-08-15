import { PrismaClient, Prisma } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

/**
 * Client connecté avec le rôle APPLICATIF (`prometis_app`), donc soumis aux
 * policies RLS. C'est le seul client dont les tests d'isolation ont le droit
 * de se servir : avec le rôle propriétaire, ils passeraient tous sans rien
 * prouver.
 */
export const appDb = new PrismaClient({ datasourceUrl: requireEnv('DATABASE_URL') });

/** Client propriétaire — uniquement pour préparer/inspecter, jamais pour prouver. */
export const ownerDb = new PrismaClient({ datasourceUrl: requireEnv('DIRECT_DATABASE_URL') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} manquante — lancer d'abord npm run db:bootstrap`);
  return value;
}

export type Tx = Prisma.TransactionClient;

/**
 * Exécute `fn` avec `app.societe_id` posé sur la transaction.
 * `societeId = null` simule l'oubli du contexte tenant.
 */
export async function asTenant<T>(
  societeId: number | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return appDb.$transaction(async (tx) => {
    if (societeId !== null) {
      await tx.$executeRaw`SELECT set_config('app.societe_id', ${String(societeId)}, true)`;
    }
    return fn(tx);
  });
}

export const CB = 1;
export const CONSTRUCTA = 2;

/**
 * Efface une opération créée par un test, enfants compris.
 *
 * La suppression en cascade ne suffit pas : `lignes_budget` référence
 * `cfc_nodes` en `Restrict`, et l'ordre d'évaluation des cascades n'est pas
 * garanti. On descend donc explicitement.
 *
 * Aucune erreur n'est avalée. Un nettoyage qui échoue en silence laisse des
 * données derrière lui, casse les suites suivantes, et envoie le diagnostic
 * dans la mauvaise direction — c'est exactement ce qui est arrivé ici.
 */
export async function supprimerOperationDeTest(operationId: number): Promise<void> {
  await ownerDb.ligneBudget.deleteMany({ where: { budgetVersion: { operationId } } });
  await ownerDb.budgetVersion.deleteMany({ where: { operationId } });
  await ownerDb.cfcNode.deleteMany({ where: { operationId } });
  await ownerDb.parking.deleteMany({ where: { lot: { bien: { operationId } } } });
  await ownerDb.lot.deleteMany({ where: { bien: { operationId } } });
  await ownerDb.operation.delete({ where: { id: operationId } });
}
