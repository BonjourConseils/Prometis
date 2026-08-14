/**
 * Lot 7 — les règles de la passerelle, sans base ni réseau.
 *
 * Deux sujets : la signature qui authentifie un webhook, et la réconciliation
 * qui décide de ce qu'on accepte d'en faire. Ce sont les deux endroits où une
 * erreur coûte cher — l'une ouvre la porte, l'autre modifie de l'argent.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  TOLERANCE_SECONDES,
  construireDedupeKey,
  signer,
  verifier,
} from '../apps/api/src/passerelle/signature';
import {
  calculerPrixTotalDepuisLot,
  planifierMiseAJour,
  statutDepuisKolabimo,
  type DonneesReservation,
} from '../apps/api/src/passerelle/reconciliation';

const SECRET = 'pk_dev_test_0123456789abcdef0123456789abcdef';
const CORPS = '{"evenement":"reservation.created","donnees":{"externalId":"abc"}}';

describe('Signature HMAC des webhooks', () => {
  it('accepte une signature qu’elle vient de produire', () => {
    const entete = signer(SECRET, CORPS);
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete })).toEqual({ valide: true });
  });

  it('refuse un corps modifié d’un seul caractère', () => {
    const entete = signer(SECRET, CORPS);
    const altere = CORPS.replace('"abc"', '"abd"');
    const resultat = verifier({ secret: SECRET, corpsBrut: altere, entete });
    expect(resultat.valide).toBe(false);
  });

  it('refuse une signature produite avec un autre secret', () => {
    const entete = signer('un-autre-secret-tout-aussi-long-000000', CORPS);
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete }).valide).toBe(false);
  });

  it('refuse une signature trop vieille — c’est la parade au rejeu', () => {
    const jadis = new Date(Date.now() - (TOLERANCE_SECONDES + 60) * 1000);
    const entete = signer(SECRET, CORPS, jadis);
    const resultat = verifier({ secret: SECRET, corpsBrut: CORPS, entete });
    expect(resultat.valide).toBe(false);
    if (!resultat.valide) expect(resultat.raison).toContain('tolérance');
  });

  it('refuse un horodatage déplacé, même avec une signature autrefois valide', () => {
    // L'horodatage fait partie du message signé : le rajeunir invalide la
    // signature au lieu de rouvrir la fenêtre.
    const jadis = new Date(Date.now() - (TOLERANCE_SECONDES + 60) * 1000);
    const ancienne = signer(SECRET, CORPS, jadis);
    const empreinte = ancienne.split('v1=')[1];
    const rajeunie = `t=${Math.floor(Date.now() / 1000)},v1=${empreinte}`;
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete: rajeunie }).valide).toBe(false);
  });

  it('refuse un en-tête absent ou malformé', () => {
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete: undefined }).valide).toBe(false);
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete: 'n’importe quoi' }).valide).toBe(
      false,
    );
  });
});

describe('Clé de dédoublonnage', () => {
  it('dérive de l’identifiant d’événement quand il existe', () => {
    const cle = construireDedupeKey({
      source: 'kolabimo',
      evenement: 'reservation.created',
      idEvenement: 'evt_42',
      corpsBrut: CORPS,
    });
    expect(cle).toBe('kolabimo:reservation.created:evt_42');
  });

  it('reste identique pour le même événement re-sérialisé autrement', () => {
    const commun = { source: 'kolabimo', evenement: 'reservation.created', idEvenement: 'evt_42' };
    expect(construireDedupeKey({ ...commun, corpsBrut: CORPS })).toBe(
      construireDedupeKey({ ...commun, corpsBrut: `${CORPS} ` }),
    );
  });

  it('retombe sur l’empreinte du corps sans identifiant, et distingue deux corps', () => {
    const sans = { source: 'kolabimo', evenement: 'reservation.created' };
    const a = construireDedupeKey({ ...sans, corpsBrut: CORPS });
    const b = construireDedupeKey({ ...sans, corpsBrut: `${CORPS} ` });
    expect(a).not.toBe(b);
    expect(a).toContain('sha256:');
  });
});

describe('Traduction des statuts Kolabimo', () => {
  it('accepte les graphies courantes, accents et casse compris', () => {
    expect(statutDepuisKolabimo('réservée')).toBe('RESERVE');
    expect(statutDepuisKolabimo('ACTE_SIGNE')).toBe('VENDU');
    expect(statutDepuisKolabimo('fonds verses')).toBe('FONDS_VERSES');
    expect(statutDepuisKolabimo('annulé')).toBe('ANNULEE');
  });

  it('lève sur un statut inconnu plutôt que de deviner', () => {
    // Retomber sur OPTION ferait sortir une vente de l'assiette des appels
    // de fonds sans que personne ne s'en aperçoive.
    expect(() => statutDepuisKolabimo('en_cours_de_signature')).toThrow(/inconnu/);
  });
});

describe('Prix total acte reconstruit depuis le lot', () => {
  it('additionne le lot et ses parkings — la règle du CLAUDE.md §5', () => {
    const total = calculerPrixTotalDepuisLot(new Prisma.Decimal('815000'), [
      new Prisma.Decimal('35000'),
    ]);
    expect(total?.toFixed(2)).toBe('850000.00');
  });

  it('ne renvoie rien sans prix de lot : mieux vaut vide que faux', () => {
    expect(calculerPrixTotalDepuisLot(null, [new Prisma.Decimal('35000')])).toBeNull();
  });
});

// ---------------------------------------------------------------------
//  Ce que Kolabimo a le droit de changer
// ---------------------------------------------------------------------

function entrant(surcharge: Partial<DonneesReservation> = {}): DonneesReservation {
  return {
    externalId: 'kolabimo-res-001',
    reservationId: 77,
    promotionId: 4201,
    appartementId: 4302,
    statut: 'reserve',
    prixTotalActe: undefined,
    dateReservation: undefined,
    dateSignatureActe: undefined,
    client: {
      ref: 'cli-001',
      nom: 'Testard',
      prenom: 'Alice',
      email: 'alice@example.ch',
      telephone: undefined,
      adresse: undefined,
    },
    ...surcharge,
  } as DonneesReservation;
}

describe('Réconciliation d’une réservation existante', () => {
  const libre = {
    statut: 'OPTION' as const,
    prixTotalActe: new Prisma.Decimal('850000'),
    dateSignatureActe: null,
    appelsEmis: 0,
  };

  it('applique statut et prix tant que rien n’est engagé', () => {
    const plan = planifierMiseAJour(
      libre,
      entrant({ prixTotalActe: new Prisma.Decimal('870000') }),
    );
    expect(plan.champs.statut).toBe('RESERVE');
    expect(plan.champs.prixTotalActe?.toFixed(2)).toBe('870000.00');
    expect(plan.refus).toHaveLength(0);
  });

  it('refuse de bouger le prix dès qu’un appel de fonds en découle', () => {
    const plan = planifierMiseAJour(
      { ...libre, statut: 'VENDU', appelsEmis: 2 },
      entrant({ statut: 'vendu', prixTotalActe: new Prisma.Decimal('900000') }),
    );
    expect(plan.champs.prixTotalActe).toBeUndefined();
    expect(plan.refus[0]?.champ).toBe('prixTotalActe');
    expect(plan.refus[0]?.raison).toContain('2 appel');
  });

  it('refuse aussi de bouger le prix une fois l’acte signé', () => {
    const plan = planifierMiseAJour(
      { ...libre, dateSignatureActe: new Date('2026-06-01') },
      entrant({ prixTotalActe: new Prisma.Decimal('900000') }),
    );
    expect(plan.champs.prixTotalActe).toBeUndefined();
    expect(plan.refus[0]?.raison).toContain('acte est signé');
  });

  it('ne signale rien quand le prix reçu est déjà le nôtre', () => {
    const plan = planifierMiseAJour(
      { ...libre, appelsEmis: 3 },
      entrant({ statut: 'option', prixTotalActe: new Prisma.Decimal('850000') }),
    );
    expect(plan.refus).toHaveLength(0);
    expect(plan.champs.prixTotalActe).toBeUndefined();
  });

  it('bloque une annulation quand des appels de fonds sont partis', () => {
    // Une créance envoyée à un acquéreur ne s'efface pas sur un webhook :
    // il faut un remboursement ou un avoir, donc quelqu'un.
    const plan = planifierMiseAJour(
      { ...libre, statut: 'VENDU', appelsEmis: 1 },
      entrant({ statut: 'annulee' }),
    );
    expect(plan.bloquant).toContain('Annulation refusée');
    expect(plan.champs).toEqual({});
  });

  it('laisse annuler une réservation sans appel de fonds', () => {
    const plan = planifierMiseAJour(libre, entrant({ statut: 'annulee' }));
    expect(plan.bloquant).toBeUndefined();
    expect(plan.champs.statut).toBe('ANNULEE');
  });

  it('refuse d’effacer la date de signature d’un acte déjà signé', () => {
    const plan = planifierMiseAJour(
      { ...libre, dateSignatureActe: new Date('2026-06-01') },
      entrant({ statut: 'vendu', dateSignatureActe: null }),
    );
    expect(plan.champs.dateSignatureActe).toBeUndefined();
    expect(plan.refus.some((r) => r.champ === 'dateSignatureActe')).toBe(true);
  });
});
