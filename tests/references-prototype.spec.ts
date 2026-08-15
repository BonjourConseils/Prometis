/**
 * Verrous de cohérence issus du prototype (Plan_Prometis.md §9.2).
 *
 * Ces chiffres circulent entre plusieurs écrans : Lots PPE, Appels de fonds,
 * Portail acquéreur. Les figer ici évite qu'une refonte du calcul les fasse
 * dériver sans que personne ne le remarque.
 *
 * Tout est lu à travers le contexte tenant, donc ces tests valident aussi
 * la traversée RLS jusqu'aux tables profondes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { appDb, ownerDb, asTenant, CB } from './tenant-db';

afterAll(async () => {
  await Promise.all([appDb.$disconnect(), ownerDb.$disconnect()]);
});

const dec = (v: string) => new Prisma.Decimal(v);

describe('prix total acte = prix du lot + Σ prix des parkings', () => {
  it('lot A02 : 815 000 + box 35 000 = 850 000 CHF', async () => {
    const lot = await asTenant(CB, (tx) =>
      tx.lot.findFirstOrThrow({
        where: { reference: 'A02' },
        include: { parkings: true, reservations: true },
      }),
    );

    const prixParkings = lot.parkings.reduce(
      (total, p) => total.plus(p.prix ?? 0),
      new Prisma.Decimal(0),
    );
    const prixTotalActe = (lot.prixVente ?? new Prisma.Decimal(0)).plus(prixParkings);

    expect(lot.prixVente!.equals(dec('815000'))).toBe(true);
    expect(prixParkings.equals(dec('35000'))).toBe(true);
    expect(prixTotalActe.equals(dec('850000'))).toBe(true);

    // Le prix est FIGÉ dans la réservation, il n'est pas recalculé depuis le lot.
    const reservation = lot.reservations[0]!;
    expect(reservation.prixTotalActe!.equals(dec('850000'))).toBe(true);
  });
});

describe('appel de fonds = pourcentage de l’étape × prix total acte', () => {
  it('5 % = 42 500 et 15 % = 127 500 sur le lot A02', async () => {
    const appels = await asTenant(CB, (tx) =>
      tx.appelDeFonds.findMany({
        where: { reservation: { lot: { reference: 'A02' } } },
        orderBy: { pourcentage: 'asc' },
      }),
    );

    expect(appels).toHaveLength(2);

    const [cinq, quinze] = appels;
    expect(cinq!.pourcentage.equals(dec('5.00'))).toBe(true);
    expect(cinq!.montant.equals(dec('42500'))).toBe(true);
    expect(quinze!.pourcentage.equals(dec('15.00'))).toBe(true);
    expect(quinze!.montant.equals(dec('127500'))).toBe(true);
  });

  it('idempotence : un couple (réservation, étape) est unique', async () => {
    const appel = await asTenant(CB, (tx) =>
      tx.appelDeFonds.findFirstOrThrow({ where: { pourcentage: dec('5.00') } }),
    );

    await expect(
      asTenant(CB, (tx) =>
        tx.appelDeFonds.create({
          data: {
            reservationId: appel.reservationId,
            etapeId: appel.etapeId,
            pourcentage: appel.pourcentage,
            montant: appel.montant,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('échéancier', () => {
  it('Σ des pourcentages non nuls = 100 %', async () => {
    const etapes = await asTenant(CB, (tx) =>
      tx.echeancierEtape.findMany({ orderBy: { ordre: 'asc' } }),
    );

    const somme = etapes.reduce(
      (total, e) => (e.pourcentage === null ? total : total.plus(e.pourcentage)),
      new Prisma.Decimal(0),
    );
    expect(somme.equals(dec('100.00'))).toBe(true);
  });

  it("la première étape est la signature de l'acte", async () => {
    const premiere = await asTenant(CB, (tx) =>
      tx.echeancierEtape.findFirstOrThrow({ orderBy: { ordre: 'asc' } }),
    );
    expect(premiere.libelle).toContain("Signature de l'acte");
  });

  it("un jalon sans pourcentage n'a généré aucun appel de fonds", async () => {
    const suivi = await asTenant(CB, (tx) =>
      tx.echeancierEtape.findFirstOrThrow({
        where: { pourcentage: null },
        include: { appelsDeFonds: true },
      }),
    );
    expect(suivi.appelsDeFonds).toHaveLength(0);
  });
});

describe('registre PPE', () => {
  it('Immeuble A (12 lots) + Immeuble B (8 lots) = 20 lots PPE', async () => {
    // Scopé à la promotion de référence : ce fichier verrouille les chiffres
    // du prototype, pas l'état global de la base. Sans ce filtre, la suite
    // tomberait dès qu'un bien est créé depuis l'interface.
    const biens = await asTenant(CB, (tx) =>
      tx.bien.findMany({
        where: { operation: { nom: 'Les Jardins de Prilly' } },
        include: { _count: { select: { lots: true } } },
        orderBy: { nom: 'asc' },
      }),
    );

    expect(biens.map((b) => [b.nom, b._count.lots])).toEqual([
      ['Immeuble A', 12],
      ['Immeuble B', 8],
    ]);
  });

  it('Σ des quotes-parts PPE = totalMillemes (1000)', async () => {
    const { lots, ppe } = await asTenant(CB, async (tx) => ({
      lots: await tx.lot.findMany({ select: { quotePartPPE: true } }),
      ppe: await tx.ppe.findFirstOrThrow(),
    }));

    const somme = lots.reduce((total, l) => total.plus(l.quotePartPPE ?? 0), new Prisma.Decimal(0));
    expect(somme.equals(new Prisma.Decimal(ppe.totalMillemes))).toBe(true);
  });

  it('les parcelles 2841 et 2842 sont rattachées à l’opération', async () => {
    const parcelles = await asTenant(CB, (tx) =>
      tx.parcelle.findMany({ select: { numero: true }, orderBy: { numero: 'asc' } }),
    );
    expect(parcelles.map((p) => p.numero)).toEqual(['2841', '2842']);
  });
});

describe('arbre CFC', () => {
  it('le poste 232.1 référencé par le prototype existe et est bien un niveau 4', async () => {
    const node = await asTenant(CB, (tx) =>
      tx.cfcNode.findFirstOrThrow({ where: { code: '232.1' }, include: { parent: true } }),
    );
    expect(node.niveau).toBe(4);
    expect(node.parent?.code).toBe('232');
  });

  it('une seule version de budget est courante', async () => {
    const courantes = await asTenant(CB, (tx) =>
      tx.budgetVersion.count({ where: { isCourant: true } }),
    );
    expect(courantes).toBe(1);
  });

  it('la provision pour imprévus est marquée comme réserve', async () => {
    const reserves = await asTenant(CB, (tx) =>
      tx.ligneBudget.findMany({ where: { estReserve: true } }),
    );
    expect(reserves).toHaveLength(1);
    expect(reserves[0]!.montant.equals(dec('450000'))).toBe(true);
  });
});

describe('modularité par profil de société', () => {
  it("l'entreprise générale n'a aucun module de commercialisation", async () => {
    const eg = await ownerDb.societe.findFirstOrThrow({
      where: { profil: 'ENTREPRISE_GENERALE' },
    });

    const modulesVente = ['LOTS', 'ACQUEREURS', 'APPELS_FONDS', 'ECHEANCIER', 'BILAN_PROMOTEUR'];
    expect(eg.modulesActifs.filter((m) => modulesVente.includes(m))).toEqual([]);
  });

  it("l'opération d'une EG a la commercialisation désactivée", async () => {
    const eg = await ownerDb.societe.findFirstOrThrow({
      where: { profil: 'ENTREPRISE_GENERALE' },
    });
    const operation = await ownerDb.operation.findFirstOrThrow({ where: { societeId: eg.id } });
    expect(operation.commercialisationActive).toBe(false);
  });
});
