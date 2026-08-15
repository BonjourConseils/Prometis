/**
 * Redirection des e-mails hors production.
 *
 * Ces tests protègent une propriété simple et coûteuse à perdre : pendant le
 * développement, aucun message ne doit atteindre un vrai acquéreur, un vrai
 * notaire ou une vraie entreprise.
 */
import { describe, expect, it } from 'vitest';
import { appliquerRedirection, type Message } from '../apps/api/src/mail/redirection.js';

const REDIRECTION = 'bonjourconseilsetimmobilier@gmail.com';

const appelDeFonds: Message = {
  to: 'sophie.meylan@example.ch',
  subject: 'Appel de fonds n° AF-2026-0001 — Les Jardins de Prilly, lot A02',
  text: 'Madame, nous vous prions de bien vouloir verser 42 500 CHF…',
  html: '<p>Madame, nous vous prions de bien vouloir verser 42 500 CHF…</p>',
};

describe('redirection active', () => {
  const redirige = appliquerRedirection(appelDeFonds, {
    redirigerVers: REDIRECTION,
    environnement: 'development',
  });

  it("remplace le destinataire par l'adresse de redirection", () => {
    expect(redirige.to).toBe(REDIRECTION);
  });

  it("met le destinataire prévu en tête de l'objet", () => {
    expect(redirige.subject).toBe(
      '[→ sophie.meylan@example.ch] Appel de fonds n° AF-2026-0001 — Les Jardins de Prilly, lot A02',
    );
  });

  it("conserve l'objet original en entier", () => {
    expect(redirige.subject).toContain(appelDeFonds.subject);
  });

  it('rappelle le destinataire prévu et l’environnement dans le corps', () => {
    expect(redirige.text).toContain('sophie.meylan@example.ch');
    expect(redirige.text).toContain('development');
    expect(redirige.html).toContain('sophie.meylan@example.ch');
  });

  it('préserve le contenu du message', () => {
    expect(redirige.text).toContain('42 500 CHF');
    expect(redirige.html).toContain('42 500 CHF');
  });
});

describe('copies et copies cachées', () => {
  const avecCopies = appliquerRedirection(
    { ...appelDeFonds, cc: 'notaire@etude.ch', bcc: 'compta@cbpromotions.ch' },
    { redirigerVers: REDIRECTION, environnement: 'development' },
  );

  it('les supprime — sinon elles partiraient vraiment', () => {
    expect(avecCopies.cc).toBeUndefined();
    expect(avecCopies.bcc).toBeUndefined();
  });

  it('mais les rappelle dans le bandeau, pour ne rien perdre', () => {
    expect(avecCopies.text).toContain('notaire@etude.ch');
    expect(avecCopies.text).toContain('compta@cbpromotions.ch');
    expect(avecCopies.html).toContain('notaire@etude.ch');
    expect(avecCopies.html).toContain('compta@cbpromotions.ch');
  });
});

describe('destinataires multiples', () => {
  it("résume la liste dans l'objet", () => {
    const redirige = appliquerRedirection(
      { ...appelDeFonds, to: ['a@example.ch', 'b@example.ch', 'c@example.ch'] },
      { redirigerVers: REDIRECTION, environnement: 'development' },
    );
    expect(redirige.subject.startsWith('[→ a@example.ch +2] ')).toBe(true);
  });

  it('mais les liste tous dans le bandeau', () => {
    const redirige = appliquerRedirection(
      { ...appelDeFonds, to: ['a@example.ch', 'b@example.ch'] },
      { redirigerVers: REDIRECTION, environnement: 'development' },
    );
    expect(redirige.text).toContain('a@example.ch, b@example.ch');
  });
});

describe('sans redirection (production)', () => {
  it('laisse le message intact', () => {
    const intact = appliquerRedirection(appelDeFonds, { environnement: 'production' });
    expect(intact).toEqual(appelDeFonds);
  });

  it("n'altère ni l'objet ni le destinataire", () => {
    const intact = appliquerRedirection(
      { ...appelDeFonds, cc: 'notaire@etude.ch' },
      { environnement: 'production' },
    );
    expect(intact.to).toBe('sophie.meylan@example.ch');
    expect(intact.subject).toBe(appelDeFonds.subject);
    expect(intact.cc).toBe('notaire@etude.ch');
  });
});

describe('robustesse du bandeau', () => {
  it('échappe le HTML des valeurs insérées', () => {
    const redirige = appliquerRedirection(
      { ...appelDeFonds, subject: '<script>alert(1)</script>' },
      { redirigerVers: REDIRECTION, environnement: 'development' },
    );
    expect(redirige.html).not.toContain('<script>');
    expect(redirige.html).toContain('&lt;script&gt;');
  });

  it('ne crée pas de corps texte si le message n’en avait pas', () => {
    const redirige = appliquerRedirection(
      { to: 'x@example.ch', subject: 'Objet', html: '<p>Seulement du HTML</p>' },
      { redirigerVers: REDIRECTION, environnement: 'development' },
    );
    expect(redirige.text).toBeUndefined();
    expect(redirige.html).toContain('Seulement du HTML');
  });
});
