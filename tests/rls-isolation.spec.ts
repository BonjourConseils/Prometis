/**
 * Lot 0 — « un test prouve qu'un tenant ne lit pas les données d'un autre ».
 *
 * Ces tests tapent la vraie base avec le rôle applicatif `prometis_app`.
 * Prérequis : npm run db:bootstrap && npm run db:migrate && npm run db:seed
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, ownerDb, asTenant, PROBAT, CONSTRUCTA } from './tenant-db';

let idsProbat: { operationId: number; bienId: number; lotId: number; parkingId: number };
let idsConstructa: { operationId: number; bienId: number; lotId: number };

beforeAll(async () => {
  // Les identifiants sont relevés avec le rôle propriétaire : les tests ont
  // besoin de connaître les ids de l'AUTRE tenant pour prouver qu'ils ne
  // peuvent pas les atteindre.
  const opProbat = await ownerDb.operation.findFirstOrThrow({
    where: { societeId: PROBAT },
    include: { biens: { include: { lots: { include: { parkings: true } } } } },
  });
  const bienProbat = opProbat.biens[0]!;
  const lotProbat = bienProbat.lots[0]!;

  const opConstructa = await ownerDb.operation.findFirstOrThrow({
    where: { societeId: CONSTRUCTA },
    include: { biens: { include: { lots: true } } },
  });
  const bienConstructa = opConstructa.biens[0]!;

  idsProbat = {
    operationId: opProbat.id,
    bienId: bienProbat.id,
    lotId: lotProbat.id,
    parkingId: lotProbat.parkings[0]!.id,
  };
  idsConstructa = {
    operationId: opConstructa.id,
    bienId: bienConstructa.id,
    lotId: bienConstructa.lots[0]!.id,
  };
});

afterAll(async () => {
  await Promise.all([appDb.$disconnect(), ownerDb.$disconnect()]);
});

// =====================================================================

describe("prérequis : le test s'exécute bien avec le rôle applicatif", () => {
  it('est connecté en prometis_app, pas en propriétaire', async () => {
    const rows = await appDb.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(rows[0]!.current_user).toBe('prometis_app');
  });

  it('le rôle applicatif ne contourne pas la RLS', async () => {
    const [role] = await appDb.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    expect(role!.rolbypassrls).toBe(false);
    expect(role!.rolsuper).toBe(false);
  });

  it("n'a aucun droit DDL sur le schéma public", async () => {
    await expect(appDb.$executeRawUnsafe('CREATE TABLE rls_probe (id int)')).rejects.toThrow();
  });
});

// =====================================================================

describe('refus par défaut : sans contexte tenant, rien ne sort', () => {
  it('ne renvoie aucune opération', async () => {
    const operations = await asTenant(null, (tx) => tx.operation.findMany());
    expect(operations).toHaveLength(0);
  });

  it('ne renvoie aucune société, aucun lot, aucun appel de fonds', async () => {
    const compte = await asTenant(null, async (tx) => ({
      societes: await tx.societe.count(),
      lots: await tx.lot.count(),
      appels: await tx.appelDeFonds.count(),
      lignesBudget: await tx.ligneBudget.count(),
    }));
    expect(compte).toEqual({ societes: 0, lots: 0, appels: 0, lignesBudget: 0 });
  });
});

// =====================================================================

describe('lecture : chaque tenant ne voit que ses données', () => {
  it('Probat voit son opération et pas celle de Constructa', async () => {
    const operations = await asTenant(PROBAT, (tx) =>
      tx.operation.findMany({ select: { id: true, nom: true } }),
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]!.nom).toBe('Les Jardins de Prilly');
    expect(operations.map((o) => o.id)).not.toContain(idsConstructa.operationId);
  });

  it('Constructa voit son opération et pas celle de Probat', async () => {
    const operations = await asTenant(CONSTRUCTA, (tx) =>
      tx.operation.findMany({ select: { id: true, nom: true } }),
    );
    expect(operations).toHaveLength(1);
    expect(operations[0]!.nom).toBe('Résidence du Lac');
    expect(operations.map((o) => o.id)).not.toContain(idsProbat.operationId);
  });

  it('la société elle-même est filtrée', async () => {
    const societes = await asTenant(PROBAT, (tx) => tx.societe.findMany());
    expect(societes).toHaveLength(1);
    expect(societes[0]!.id).toBe(PROBAT);
  });

  it("un accès direct par id à l'opération de l'autre tenant ne renvoie rien", async () => {
    const trouve = await asTenant(CONSTRUCTA, (tx) =>
      tx.operation.findUnique({ where: { id: idsProbat.operationId } }),
    );
    expect(trouve).toBeNull();
  });
});

// =====================================================================

describe('tables sans societe_id : la chaîne de rattachement tient', () => {
  it('biens — via operation_id', async () => {
    const vus = await asTenant(CONSTRUCTA, (tx) => tx.bien.findMany({ select: { id: true } }));
    expect(vus.map((b) => b.id)).not.toContain(idsProbat.bienId);
    expect(
      await asTenant(CONSTRUCTA, (tx) => tx.bien.findUnique({ where: { id: idsProbat.bienId } })),
    ).toBeNull();
  });

  it('lots — via bien → operation (deux niveaux)', async () => {
    expect(
      await asTenant(CONSTRUCTA, (tx) => tx.lot.findUnique({ where: { id: idsProbat.lotId } })),
    ).toBeNull();
    // Et Probat, lui, voit bien ses 20 lots PPE.
    expect(await asTenant(PROBAT, (tx) => tx.lot.count())).toBe(20);
  });

  it('parkings — via lot → bien → operation (trois niveaux)', async () => {
    expect(
      await asTenant(CONSTRUCTA, (tx) =>
        tx.parking.findUnique({ where: { id: idsProbat.parkingId } }),
      ),
    ).toBeNull();
    expect(await asTenant(PROBAT, (tx) => tx.parking.count())).toBe(20);
  });

  it('appels de fonds et encaissements — via reservation → operation', async () => {
    expect(await asTenant(CONSTRUCTA, (tx) => tx.appelDeFonds.count())).toBe(0);
    expect(await asTenant(CONSTRUCTA, (tx) => tx.encaissement.count())).toBe(0);
    expect(await asTenant(PROBAT, (tx) => tx.appelDeFonds.count())).toBe(2);
  });

  it('lignes de budget — via budget_version → operation', async () => {
    const probat = await asTenant(PROBAT, (tx) => tx.ligneBudget.count());
    const constructa = await asTenant(CONSTRUCTA, (tx) => tx.ligneBudget.count());
    expect(probat).toBe(17);
    expect(constructa).toBe(4);
  });

  it("échéancier — l'EG ne voit que ses propres jalons", async () => {
    const etapes = await asTenant(CONSTRUCTA, (tx) =>
      tx.echeancierEtape.findMany({ select: { libelle: true, pourcentage: true } }),
    );
    expect(etapes).toHaveLength(4);
    // Jalons de suivi de chantier : aucun pourcentage, donc aucun appel de fonds.
    expect(etapes.every((e) => e.pourcentage === null)).toBe(true);
  });
});

// =====================================================================

describe("écriture : WITH CHECK empêche d'écrire chez le voisin", () => {
  it("refuse de créer un bien sur l'opération d'un autre tenant", async () => {
    await expect(
      asTenant(CONSTRUCTA, (tx) =>
        tx.bien.create({
          data: { operationId: idsProbat.operationId, nature: 'IMMEUBLE', nom: 'Bien pirate' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuse de créer une opération pour une autre société', async () => {
    await expect(
      asTenant(CONSTRUCTA, (tx) =>
        tx.operation.create({ data: { societeId: PROBAT, nom: 'Opération pirate' } }),
      ),
    ).rejects.toThrow();
  });

  it("une mise à jour ciblant l'opération d'un autre tenant ne touche aucune ligne", async () => {
    const { count } = await asTenant(CONSTRUCTA, (tx) =>
      tx.operation.updateMany({
        where: { id: idsProbat.operationId },
        data: { nom: 'Renommée par le voisin' },
      }),
    );
    expect(count).toBe(0);

    // Vérification par le propriétaire : le nom est intact.
    const operation = await ownerDb.operation.findUniqueOrThrow({
      where: { id: idsProbat.operationId },
    });
    expect(operation.nom).toBe('Les Jardins de Prilly');
  });

  it("une suppression ciblant les lots d'un autre tenant ne touche aucune ligne", async () => {
    const { count } = await asTenant(CONSTRUCTA, (tx) =>
      tx.lot.deleteMany({ where: { id: idsProbat.lotId } }),
    );
    expect(count).toBe(0);
    expect(await ownerDb.lot.count({ where: { id: idsProbat.lotId } })).toBe(1);
  });
});

// =====================================================================

describe('inventaire : aucune table ne passe entre les mailles', () => {
  it('chaque table publique a une policy ou une exemption documentée', async () => {
    const orphelines = await appDb.$queryRaw<{ tablename: string }[]>`
      SELECT t.tablename
      FROM pg_tables t
      WHERE t.schemaname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = t.tablename
        )
        AND NOT EXISTS (
          SELECT 1 FROM app.rls_exemptions e WHERE e.table_name = t.tablename
        )
      ORDER BY 1
    `;
    expect(orphelines.map((t) => t.tablename)).toEqual([]);
  });

  it('chaque table avec une policy a bien la RLS activée', async () => {
    const inactives = await appDb.$queryRaw<{ tablename: string }[]>`
      SELECT DISTINCT p.tablename
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE p.schemaname = 'public' AND c.relrowsecurity IS FALSE
      ORDER BY 1
    `;
    expect(inactives.map((t) => t.tablename)).toEqual([]);
  });

  it('chaque policy pose USING et WITH CHECK', async () => {
    const incompletes = await appDb.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_policies
      WHERE schemaname = 'public' AND (qual IS NULL OR with_check IS NULL)
      ORDER BY 1
    `;
    expect(incompletes.map((t) => t.tablename)).toEqual([]);
  });

  it('couvre les 38 tables tenant du modèle', async () => {
    const rows = await appDb.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    `;
    expect(Number(rows[0]!.count)).toBe(38);
  });
});
