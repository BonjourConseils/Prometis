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
  empreinteNue,
  signer,
  verifier,
} from '../apps/api/src/passerelle/signature';
import { normaliser } from '../apps/api/src/passerelle/contrat-kolabimo';
import {
  calculerPrixTotalDepuisLot,
  dossierDepuisContratInterne,
  dossierDepuisContratKolabimo,
  planifierMiseAJour,
  statutDepuisKolabimo,
  type DossierEntrant,
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

function entrant(surcharge: Partial<DossierEntrant> = {}): DossierEntrant {
  return {
    externalId: 'kolabimo-res-001',
    reservationId: 77,
    promotionId: 4201,
    appartementId: 4302,
    statut: 'reserve',
    prixTotalActe: undefined,
    dateReservation: undefined,
    dateSignatureActe: undefined,
    clientRef: 'cli-001',
    personnes: [{ role: 'ACQUEREUR', nom: 'Testard', prenom: 'Alice', email: 'alice@example.ch' }],
    ...surcharge,
  } as DossierEntrant;
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

// ---------------------------------------------------------------------
//  Le contrat publié par Kolabimo (v1.3.0)
// ---------------------------------------------------------------------

describe('Contrat Kolabimo — signature hexadécimale nue', () => {
  it('accepte l’empreinte du corps brut, sans horodatage', () => {
    const entete = empreinteNue(SECRET, CORPS);
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete })).toEqual({ valide: true });
  });

  it('refuse une empreinte calculée sur un autre corps', () => {
    const entete = empreinteNue(SECRET, '{"autre":"corps"}');
    expect(verifier({ secret: SECRET, corpsBrut: CORPS, entete }).valide).toBe(false);
  });

  it('n’ouvre pas la porte à la forme horodatée : les deux restent distinctes', () => {
    // Le même secret, le même corps, mais deux empreintes différentes —
    // l'une lie l'horodatage au message, l'autre non.
    const nue = empreinteNue(SECRET, CORPS);
    const horodatee = signer(SECRET, CORPS);
    expect(horodatee).not.toContain(nue);
  });
});

describe('Contrat Kolabimo — normalisation de l’enveloppe', () => {
  const corpsKolabimo = {
    event: 'reservation.created',
    delivery: 'evt-98765',
    emisLe: '2026-09-02T10:00:00.000Z',
    reservation: {
      externalId: 'kolabimo-res-777',
      appartementId: 4302,
      statut: 'reserve',
      client: { reference: 'cli-pseudo-777' },
    },
  };

  it('lit l’événement et la clé de déduplication dans les EN-TÊTES', () => {
    // Ils priment sur le corps : c'est `X-Kolabimo-Delivery` que Kolabimo
    // promet unique par événement.
    const e = normaliser(corpsKolabimo, {
      evenement: 'reservation.step_changed',
      livraison: 'entete-42',
    });
    expect(e.evenement).toBe('reservation.step_changed');
    expect(e.idEvenement).toBe('entete-42');
    expect(e.contratKolabimo).toBe(true);
  });

  it('retombe sur le corps quand les en-têtes manquent', () => {
    const e = normaliser(corpsKolabimo);
    expect(e.evenement).toBe('reservation.created');
    expect(e.idEvenement).toBe('evt-98765');
  });

  it('reconnaît toujours notre propre enveloppe', () => {
    const e = normaliser({
      evenement: 'lot.updated',
      idEvenement: 'interne-1',
      donnees: { promotionId: 1, appartementId: 2 },
    });
    expect(e.contratKolabimo).toBe(false);
    expect(e.evenement).toBe('lot.updated');
  });

  it('distingue une charge d’étape d’une charge de réservation', () => {
    const e = normaliser(
      {
        event: 'echeancier.etape_completed',
        promotion: { id: 4201 },
        etape: { id: 77, statut: 'COMPLETED' },
      },
      { evenement: 'echeancier.etape_completed' },
    );
    expect(e.contratKolabimo).toBe(true);
    expect(e.donnees).toMatchObject({ promotion: { id: 4201 } });
  });
});

describe('L’identité n’arrive qu’à FONDS_VERSES', () => {
  it('avant le palier : la référence seule, et AUCUNE personne', () => {
    const dossier = dossierDepuisContratKolabimo({
      id: 701,
      externalId: 'res-1',
      appartementId: 4302,
      statut: 'reserve',
      client: { reference: 'cli-pseudo-1' },
    });
    expect(dossier.clientRef).toBe('cli-pseudo-1');
    // `undefined`, pas `[]` : un tableau vide voudrait dire « ce dossier n'a
    // personne », ce qui effacerait l'identité au premier événement suivant.
    expect(dossier.personnes).toBeUndefined();
  });

  it('au palier : N personnes, avec rôle et quote-part en fraction', () => {
    const dossier = dossierDepuisContratKolabimo({
      id: 702,
      externalId: 'res-1',
      appartementId: 4302,
      statut: 'fonds_verses',
      client: {
        reference: 'cli-pseudo-1',
        niveau: 'COMPLET',
        regime: 'INDIVISION',
        personnes: [
          {
            role: 'ACQUEREUR',
            type: 'PHYSIQUE',
            nom: 'Rossier',
            prenom: 'Anne',
            email: 'anne@example.ch',
            quotePart: '1/3',
            signataire: true,
          },
          { role: 'CO_ACQUEREUR', nom: 'Rossier', prenom: 'Marc', quotePart: '1/3' },
          { role: 'SOCIETE', type: 'MORALE', raisonSociale: 'Rossier SA', quotePart: '1/3' },
        ],
      },
    });
    expect(dossier.personnes).toHaveLength(3);
    expect(dossier.personnes![0]!.quotePart).toBe('1/3');
    expect(dossier.personnes![2]!.raisonSociale).toBe('Rossier SA');
  });

  it('accepte une société sans nom ni prénom : elle n’en a pas', () => {
    const dossier = dossierDepuisContratKolabimo({
      id: 703,
      externalId: 'res-2',
      appartementId: 4302,
      statut: 'fonds_verses',
      client: {
        reference: 'cli-2',
        personnes: [{ role: 'ACQUEREUR', type: 'MORALE', raisonSociale: 'Immo SA', ide: 'CHE-1' }],
      },
    });
    expect(dossier.personnes![0]!.raisonSociale).toBe('Immo SA');
  });

  it('notre contrat interne se traduit en une personne unique', () => {
    const dossier = dossierDepuisContratInterne({
      externalId: 'res-3',
      promotionId: 4201,
      appartementId: 4302,
      statut: 'reserve',
      client: { ref: 'cli-3', nom: 'Perrin', prenom: 'Camille' },
    });
    expect(dossier.personnes).toHaveLength(1);
    expect(dossier.personnes![0]!.signataire).toBe(true);
  });

  it('un client interne sans aucune identité ne fabrique pas d’acquéreur vide', () => {
    const dossier = dossierDepuisContratInterne({
      externalId: 'res-4',
      promotionId: 4201,
      appartementId: 4302,
      statut: 'reserve',
      client: { ref: 'cli-4' },
    });
    expect(dossier.personnes).toBeUndefined();
  });
});

describe('Le contrat relevé dans le code de Kolabimo (1.3.20)', () => {
  it('accepte une réservation posée dans l’interface : externalId NUL', () => {
    // Seules les réservations créées par l'API Kolabimo portent un externalId.
    const dossier = dossierDepuisContratKolabimo({
      id: 42,
      externalId: null,
      appartementId: 4302,
      statut: 'RESERVE',
      client: { reference: 'Dupont' },
    });
    expect(dossier.externalId).toBeNull();
    expect(dossier.reservationId).toBe(42);
  });

  it('donne une référence de dossier à une réservation qui n’en a pas', () => {
    // Deux dossiers sans référence ne doivent pas partager leurs acquéreurs.
    const a = dossierDepuisContratKolabimo({
      id: 1,
      appartementId: 1,
      statut: 'RESERVE',
      client: { reference: null },
    });
    const b = dossierDepuisContratKolabimo({
      id: 2,
      appartementId: 1,
      statut: 'RESERVE',
      client: { reference: null },
    });
    expect(a.clientRef).not.toBe(b.clientRef);
  });

  it('lit la signature de l’acte dans `dateSignature`, le nom que lui donne Kolabimo', () => {
    const dossier = dossierDepuisContratKolabimo({
      id: 3,
      appartementId: 1,
      statut: 'VENDU',
      dateSignature: '2026-09-01T09:00:00.000Z',
      client: { reference: 'x' },
    });
    expect(dossier.dateSignatureActe?.toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });

  it('traduit les anciens statuts que Kolabimo normalise encore', () => {
    expect(statutDepuisKolabimo('ACTIVE')).toBe('RESERVE');
    expect(statutDepuisKolabimo('VERSEMENT_CONFIRME')).toBe('FONDS_VERSES');
    expect(statutDepuisKolabimo('SIGNEE_VENDU')).toBe('VENDU');
  });

  it('un bien partagé n’a pas d’appartement : hors des promotions', () => {
    const dossier = dossierDepuisContratKolabimo({
      id: 4,
      appartementId: null,
      statut: 'RESERVE',
      client: { reference: 'x' },
    });
    expect(dossier.appartementId).toBeNull();
  });
});
