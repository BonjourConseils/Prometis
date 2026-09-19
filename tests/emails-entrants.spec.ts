/**
 * Réception des factures par e-mail — une adresse par promotion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb, supprimerOperationDeTest } from './tenant-db';
import {
  adresseBoite,
  decider,
  genererJetonBoite,
  jetonDepuisAdresses,
  slug,
  verdictAuthentification,
} from '../apps/api/src/factures/emails-regles';

const DOMAINE = process.env.FACTURES_EMAIL_DOMAINE ?? 'factures.prometis.test';
const CONNU = 'compta@entreprise-email-test.ch';

describe('règles', () => {
  it('une adresse lisible, un jeton impossible à deviner', () => {
    const j = genererJetonBoite();
    expect(j).toMatch(/^[a-z2-9]{12}$/);
    expect(adresseBoite('Les Jardins de Prilly', j, 'factures.x.ch')).toBe(
      `les-jardins-de-prilly-${j}@factures.x.ch`,
    );
    expect(slug('Écoquartier « Éole » — lot B')).toBe('ecoquartier-eole-lot-b');
  });

  it('retrouve le jeton parmi les destinataires, pas ailleurs', () => {
    const j = 'k3q9x7m2p4tz';
    expect(jetonDepuisAdresses([`Promo <prilly-${j}@factures.x.ch>`], 'factures.x.ch')).toBe(j);
    expect(jetonDepuisAdresses([`prilly-${j}@autre.ch`], 'factures.x.ch')).toBeNull();
    expect(jetonDepuisAdresses([`nouveau-nom-${j}+facture@factures.x.ch`], 'factures.x.ch')).toBe(
      j,
    );
  });

  it('lit le verdict d’authentification', () => {
    expect(
      verdictAuthentification('mx.x; spf=pass smtp.mailfrom=a.ch; dkim=pass; dmarc=pass'),
    ).toBe('ok');
    expect(verdictAuthentification('mx.x; spf=pass; dmarc=fail')).toBe('echec');
    expect(verdictAuthentification('mx.x; spf=softfail; dkim=none')).toBe('echec');
    expect(verdictAuthentification(null)).toBe('inconnue');
  });

  it('inconnu ou usurpé : quarantaine ; connu : accepté', () => {
    const connus = new Set([CONNU]);
    expect(
      decider({ expediteur: CONNU, connus, ouverte: false, authentification: 'ok' }).statut,
    ).toBe('ACCEPTE');
    expect(
      decider({ expediteur: 'x@y.ch', connus, ouverte: false, authentification: 'ok' }).statut,
    ).toBe('QUARANTAINE');
    expect(
      decider({ expediteur: 'x@y.ch', connus, ouverte: true, authentification: 'inconnue' }).statut,
    ).toBe('ACCEPTE');
    expect(
      decider({ expediteur: CONNU, connus, ouverte: true, authentification: 'echec' }).statut,
    ).toBe('QUARANTAINE');
  });
});

// =====================================================================

let christophe = '';
let operationId = 0;
let adresse = '';
let entrepriseId = 0;
let pdf: Buffer;

function pdfFacture(): Promise<Buffer> {
  return new Promise((ok) => {
    const d = new PDFDocument();
    const m: Buffer[] = [];
    d.on('data', (b: Buffer) => m.push(b));
    d.on('end', () => ok(Buffer.concat(m)));
    for (const l of [
      'Entreprise E-mail Test SA',
      'Facture n° EM-77',
      'Date : 12.09.2026',
      "Total HT CHF 12'000.00",
      'TVA 8.1 % CHF 972.00',
      "Total TTC CHF 12'972.00",
      'Merci de votre confiance, payable à 30 jours net.',
    ])
      d.text(l);
    d.end();
  });
}

let compteur = 0;
function message(p: {
  de: string;
  a: string;
  piece?: Buffer;
  auth?: string;
  messageId?: string;
}): string {
  const frontiere = 'frontiere-test';
  const id = p.messageId ?? `<test-${Date.now()}-${compteur++}@entreprise-email-test.ch>`;
  const entetes = [
    ...(p.auth ? [`Authentication-Results: mx.prometis.test; ${p.auth}`] : []),
    `From: Comptabilite <${p.de}>`,
    `To: ${p.a}`,
    'Subject: Facture EM-77',
    `Message-ID: ${id}`,
    'Date: Sat, 12 Sep 2026 10:00:00 +0200',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${frontiere}"`,
  ];
  const corps = [
    `--${frontiere}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Veuillez trouver notre facture en annexe.',
    ...(p.piece
      ? [
          `--${frontiere}`,
          'Content-Type: application/pdf; name="EM-77.pdf"',
          'Content-Disposition: attachment; filename="EM-77.pdf"',
          'Content-Transfer-Encoding: base64',
          '',
          p.piece.toString('base64').replace(/.{76}/g, '$&\r\n'),
        ]
      : []),
    `--${frontiere}--`,
    '',
  ];
  return Buffer.from([...entetes, '', ...corps].join('\r\n')).toString('base64');
}

async function envoyer(b64: string, secret = process.env.EMAIL_ENTRANT_SECRET ?? '') {
  const res = await fetch(`${API}/internal/emails-entrants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-email-secret': secret },
    body: JSON.stringify({ message: b64 }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as {
      statut: string;
      emailId?: number;
      raison?: string;
    },
  };
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  operationId = (
    await appel<{ id: number }>('/operations', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Bac à sable e-mail — test' },
    })
  ).body.id;
  entrepriseId = (
    await appel<{ id: number }>('/entreprises', {
      methode: 'POST',
      token: christophe,
      corps: { nom: 'Entreprise E-mail Test SA', email: CONNU },
    })
  ).body.id;
  pdf = await pdfFacture();
});

afterAll(async () => {
  if (operationId) await supprimerOperationDeTest(operationId);
  await ownerDb.entreprise.deleteMany({ where: { id: entrepriseId } });
  await ownerDb.$disconnect();
});

describe('la boîte d’une promotion', () => {
  it('sans adresse au départ ; on la crée', async () => {
    const b = await appel<{ disponible: boolean; adresse: string | null }>(
      `/operations/${operationId}/factures/boite`,
      { token: christophe },
    );
    expect(b.body.disponible).toBe(true);
    expect(b.body.adresse).toBeNull();
    const r = await appel<{ adresse: string }>(
      `/operations/${operationId}/factures/boite/renouveler`,
      { methode: 'POST', token: christophe },
    );
    adresse = r.body.adresse;
    expect(adresse).toMatch(
      new RegExp(`^bac-a-sable-e-mail-test-[a-z2-9]{12}@${DOMAINE.replace(/\./g, '\\.')}$`),
    );
  });

  it('la route interne exige son secret', async () => {
    expect((await envoyer(message({ de: CONNU, a: adresse, piece: pdf }), 'mauvais')).status).toBe(
      401,
    );
  });

  it('une adresse inventée : ignorée', async () => {
    const r = await envoyer(message({ de: CONNU, a: `x-aaaaaaaaaaaa@${DOMAINE}`, piece: pdf }));
    expect(r.body).toMatchObject({ statut: 'ignore' });
  });
});

describe('recevoir', () => {
  const idConnu = '<connu-1@entreprise-email-test.ch>';

  it('expéditeur connu, pièce jointe : acceptée, et lue comme un dépôt', async () => {
    const r = await envoyer(
      message({
        de: CONNU,
        a: adresse,
        piece: pdf,
        auth: 'spf=pass; dkim=pass; dmarc=pass',
        messageId: idConnu,
      }),
    );
    expect(r.body.statut).toBe('ACCEPTE');
    const f = await ownerDb.facture.findFirstOrThrow({ where: { operationId, source: 'EMAIL' } });
    for (let i = 0; i < 30; i++) {
      const x = await ownerDb.facture.findUniqueOrThrow({ where: { id: f.id } });
      if (x.statut !== 'EN_LECTURE') break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const lue = await ownerDb.facture.findUniqueOrThrow({ where: { id: f.id } });
    expect(lue.numero).toBe('EM-77');
    expect(lue.entrepriseId).toBe(entrepriseId);
  });

  it('le même message relu : rien de plus', async () => {
    const r = await envoyer(message({ de: CONNU, a: adresse, piece: pdf, messageId: idConnu }));
    expect(r.body.statut).toBe('doublon');
    expect(await ownerDb.facture.count({ where: { operationId, source: 'EMAIL' } })).toBe(1);
  });

  it('adresse d’envoi usurpée : quarantaine, même pour un expéditeur connu', async () => {
    const r = await envoyer(
      message({ de: CONNU, a: adresse, piece: pdf, auth: 'spf=fail; dkim=none; dmarc=fail' }),
    );
    expect(r.body.statut).toBe('QUARANTAINE');
  });

  it('sans pièce jointe : rejeté, avec un motif', async () => {
    const r = await envoyer(message({ de: CONNU, a: adresse }));
    expect(r.body.statut).toBe('REJETE');
  });

  it('expéditeur inconnu : quarantaine, puis libéré à la main', async () => {
    const autre = await pdfFacture();
    const r = await envoyer(message({ de: 'inconnu@ailleurs.ch', a: adresse, piece: autre }));
    expect(r.body.statut).toBe('QUARANTAINE');
    const avant = await ownerDb.facture.count({ where: { operationId } });
    const l = await appel<{ acceptees: number }>(
      `/operations/${operationId}/factures/emails/${r.body.emailId}/liberer`,
      { methode: 'POST', token: christophe },
    );
    expect(l.status).toBe(200);
    expect(l.body.acceptees).toBe(1);
    expect(await ownerDb.facture.count({ where: { operationId } })).toBe(avant + 1);
    const liste = await appel<{ statut: string }[]>(`/operations/${operationId}/factures/emails`, {
      token: christophe,
    });
    expect(liste.body.length).toBeGreaterThanOrEqual(4);
  });

  it('une adresse renouvelée cesse de recevoir', async () => {
    const ancienne = adresse;
    await appel(`/operations/${operationId}/factures/boite/renouveler`, {
      methode: 'POST',
      token: christophe,
    });
    const r = await envoyer(message({ de: CONNU, a: ancienne, piece: pdf }));
    expect(r.body).toMatchObject({ statut: 'ignore' });
  });
});
