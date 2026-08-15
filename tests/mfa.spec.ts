/**
 * Lot 9 — le second facteur, vérifié contre la norme.
 *
 * L'intérêt d'avoir écrit TOTP plutôt que de l'importer, c'est que la RFC 6238
 * publie ses vecteurs de test : on ne vérifie pas que le code fait « quelque
 * chose de plausible », on vérifie qu'il produit **exactement** les chiffres
 * que la norme annonce. Si un seul diffère, l'application d'authentification
 * de l'utilisateur ne s'accordera pas avec la nôtre.
 */
import { describe, expect, it } from 'vitest';
import {
  FENETRE_PAS,
  PAS_SECONDES,
  codeTotp,
  decoderBase32,
  encoderBase32,
  genererCodesSecours,
  genererSecret,
  normaliserCodeSecours,
  uriOtpauth,
  verifierCode,
} from '../apps/api/src/auth/totp';
import { chiffrer, dechiffrer, empreinteCodeSecours } from '../apps/api/src/auth/chiffrement';

/** Le secret des vecteurs de la RFC : les octets ASCII « 12345678901234567890 ». */
const SECRET_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const instant = (secondes: number) => new Date(secondes * 1000);

describe('Base32', () => {
  it('encode le secret de la RFC comme la norme l’écrit', () => {
    // Contre-vérification indépendante : cette chaîne est celle publiée avec
    // les vecteurs, pas une valeur produite par notre propre encodeur.
    expect(encoderBase32(Buffer.from('12345678901234567890', 'ascii'))).toBe(SECRET_RFC);
  });

  it('fait l’aller-retour sans rien perdre', () => {
    const secret = genererSecret();
    expect(encoderBase32(decoderBase32(secret))).toBe(secret);
  });

  it('refuse un caractère hors alphabet', () => {
    // « 1 » et « 0 » sont absents de l'alphabet base32, précisément pour
    // qu'on ne les confonde pas avec « I » et « O » en les recopiant.
    expect(() => decoderBase32('ABC1')).toThrow(/base32/);
  });
});

describe('TOTP — vecteurs de la RFC 6238', () => {
  // Les vecteurs officiels sont donnés en 8 chiffres, avec SHA-1.
  const vecteurs: [number, string][] = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];

  for (const [secondes, attendu] of vecteurs) {
    it(`T = ${secondes} → ${attendu}`, () => {
      expect(codeTotp(SECRET_RFC, instant(secondes), { chiffres: 8 })).toBe(attendu);
    });
  }
});

describe('Vérification d’un code', () => {
  const maintenant = instant(1_700_000_000);

  it('accepte le code du pas courant', () => {
    const code = codeTotp(SECRET_RFC, maintenant);
    expect(verifierCode(SECRET_RFC, code, maintenant)).toBe(true);
  });

  it('accepte le pas précédent et le suivant — dérive d’horloge', () => {
    const avant = codeTotp(SECRET_RFC, instant(1_700_000_000 - PAS_SECONDES));
    const apres = codeTotp(SECRET_RFC, instant(1_700_000_000 + PAS_SECONDES));
    expect(verifierCode(SECRET_RFC, avant, maintenant)).toBe(true);
    expect(verifierCode(SECRET_RFC, apres, maintenant)).toBe(true);
  });

  it('refuse au-delà de la fenêtre', () => {
    const tropVieux = codeTotp(
      SECRET_RFC,
      instant(1_700_000_000 - PAS_SECONDES * (FENETRE_PAS + 2)),
    );
    expect(verifierCode(SECRET_RFC, tropVieux, maintenant)).toBe(false);
  });

  it('refuse un code d’un autre secret', () => {
    const autre = genererSecret();
    expect(verifierCode(SECRET_RFC, codeTotp(autre, maintenant), maintenant)).toBe(false);
  });

  it('refuse ce qui n’a pas la forme d’un code', () => {
    expect(verifierCode(SECRET_RFC, '', maintenant)).toBe(false);
    expect(verifierCode(SECRET_RFC, '12345', maintenant)).toBe(false);
    expect(verifierCode(SECRET_RFC, 'abcdef', maintenant)).toBe(false);
  });

  it('tolère les espaces de recopie', () => {
    const code = codeTotp(SECRET_RFC, maintenant);
    expect(verifierCode(SECRET_RFC, `${code.slice(0, 3)} ${code.slice(3)}`, maintenant)).toBe(true);
  });
});

describe('URI otpauth', () => {
  it('porte le secret, l’émetteur et la période', () => {
    const uri = uriOtpauth(SECRET_RFC, { compte: 'christophe@probat.ch', emetteur: 'Prometis' });
    expect(uri.startsWith('otpauth://totp/Prometis%3Achristophe%40probat.ch?')).toBe(true);
    expect(uri).toContain(`secret=${SECRET_RFC}`);
    expect(uri).toContain('issuer=Prometis');
    expect(uri).toContain(`period=${PAS_SECONDES}`);
  });
});

describe('Codes de secours', () => {
  it('en produit dix, tous distincts', () => {
    const codes = genererCodesSecours();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it('se compare sans tenir compte des tirets ni de la casse', () => {
    const code = genererCodesSecours(1)[0]!;
    expect(normaliserCodeSecours(code.toUpperCase())).toBe(normaliserCodeSecours(code));
    expect(normaliserCodeSecours(code)).not.toContain('-');
  });

  it('ne se retrouve pas depuis son empreinte', () => {
    const code = genererCodesSecours(1)[0]!;
    const empreinte = empreinteCodeSecours(normaliserCodeSecours(code));
    expect(empreinte).not.toContain(normaliserCodeSecours(code));
    expect(empreinteCodeSecours(normaliserCodeSecours(code))).toBe(empreinte);
  });
});

describe('Chiffrement du secret au repos', () => {
  const cle = 'une-cle-de-developpement-de-plus-de-32-caracteres';

  it('fait l’aller-retour', () => {
    const chiffre = chiffrer(SECRET_RFC, cle);
    expect(chiffre).not.toContain(SECRET_RFC);
    expect(dechiffrer(chiffre, cle)).toBe(SECRET_RFC);
  });

  it('produit un chiffré différent à chaque fois — le nonce change', () => {
    expect(chiffrer(SECRET_RFC, cle)).not.toBe(chiffrer(SECRET_RFC, cle));
  });

  it('refuse de déchiffrer avec une autre clé', () => {
    const chiffre = chiffrer(SECRET_RFC, cle);
    expect(() => dechiffrer(chiffre, `${cle}-autre`)).toThrow();
  });

  it('détecte une valeur modifiée en base', () => {
    // GCM authentifie : altérer le chiffré fait échouer le déchiffrement au
    // lieu de rendre un secret silencieusement faux.
    const chiffre = chiffrer(SECRET_RFC, cle);
    const altere = chiffre.slice(0, -2) + (chiffre.endsWith('A') ? 'BB' : 'AA');
    expect(() => dechiffrer(altere, cle)).toThrow();
  });

  it('refuse d’opérer sans clé configurée', () => {
    // Sans clé, on ne stocke pas en clair : un secret TOTP lisible en base
    // vaut l'absence de second facteur.
    expect(() => chiffrer(SECRET_RFC, undefined)).toThrow(/MFA_ENCRYPTION_KEY/);
    expect(() => chiffrer(SECRET_RFC, 'trop-court')).toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
