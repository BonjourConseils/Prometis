/**
 * Les barrières de sécurité, sans base ni réseau (skill `securite-saas`).
 *
 * Chacune a été écrite pour une attaque précise ; chaque test rejoue
 * l'attaque, pas seulement le cas nominal.
 */
import { describe, expect, it } from 'vitest';
import { ipClient } from '../apps/api/src/securite/ip-client';
import { Limiteur, REGLES } from '../apps/api/src/securite/limiteur';
import { detecterType, typeAccepte } from '../apps/api/src/securite/type-fichier';
import { entetesApi } from '../apps/api/src/securite/entetes';

const SECRET = 's'.repeat(40);

describe('L’adresse du client derrière le relais', () => {
  it('croit l’adresse relayée quand elle vient avec le secret', () => {
    const ip = ipClient({
      ipConnexion: '::ffff:10.0.0.5',
      entetes: { 'x-prometis-relais': SECRET, 'x-prometis-client-ip': '203.0.113.7' },
      secretRelais: SECRET,
    });
    expect(ip).toBe('203.0.113.7');
  });

  it('ignore une adresse forgée par un appelant direct, sans le secret', () => {
    // L'API est joignable directement (webhooks) : un en-tête d'IP, n'importe
    // qui peut l'écrire pour échapper à la limite de tentatives.
    const ip = ipClient({
      ipConnexion: '198.51.100.9',
      entetes: { 'x-prometis-relais': 'devine', 'x-prometis-client-ip': '1.2.3.4' },
      secretRelais: SECRET,
    });
    expect(ip).toBe('198.51.100.9');
  });

  it('sans secret configuré, ne croit personne', () => {
    const ip = ipClient({
      ipConnexion: '127.0.0.1',
      entetes: { 'x-prometis-client-ip': '1.2.3.4' },
      secretRelais: undefined,
    });
    expect(ip).toBe('127.0.0.1');
  });

  it('refuse un texte qui n’est pas une adresse — il finirait dans le journal', () => {
    const ip = ipClient({
      ipConnexion: '10.0.0.1',
      entetes: { 'x-prometis-relais': SECRET, 'x-prometis-client-ip': '<script>' },
      secretRelais: SECRET,
    });
    expect(ip).toBe('10.0.0.1');
  });
});

describe('Le limiteur de tentatives', () => {
  it('bloque au cinquième échec, et le dit', () => {
    const l = new Limiteur(REGLES.compte);
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) expect(l.echec('c', t + i).autorise).toBe(true);
    expect(l.echec('c', t + 4).autorise).toBe(false);
    expect(l.verifier('c', t + 5).autorise).toBe(false);
  });

  it('débloque à l’expiration du blocage', () => {
    const l = new Limiteur(REGLES.compte);
    for (let i = 0; i < 5; i++) l.echec('c', i);
    expect(l.verifier('c', REGLES.compte.blocageMs + 10).autorise).toBe(true);
  });

  it('oublie les échecs sortis de la fenêtre', () => {
    const l = new Limiteur(REGLES.compte);
    for (let i = 0; i < 4; i++) l.echec('c', i);
    // Un cinquième échec, mais longtemps après les quatre premiers.
    expect(l.echec('c', REGLES.compte.fenetreMs + 100).autorise).toBe(true);
  });

  it('une réussite remet le compteur à zéro', () => {
    const l = new Limiteur(REGLES.compte);
    for (let i = 0; i < 4; i++) l.echec('c', i);
    l.reinitialiser('c');
    expect(l.echec('c', 5).autorise).toBe(true);
  });

  it('les clés sont indépendantes : un compte bloqué n’en bloque pas un autre', () => {
    const l = new Limiteur(REGLES.compte);
    for (let i = 0; i < 5; i++) l.echec('a', i);
    expect(l.verifier('b', 6).autorise).toBe(true);
  });
});

describe('Le type d’un fichier se lit dans ses octets', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n');
  const html = Buffer.from('<html><script>alert(1)</script></html>');

  it('reconnaît un PDF, quel que soit son nom', () => {
    expect(detecterType(pdf, 'facture.pdf')?.mime).toBe('application/pdf');
    expect(detecterType(pdf, 'sans-extension')?.mime).toBe('application/pdf');
  });

  it('refuse du HTML déguisé en PDF — le type annoncé ne compte pas', () => {
    expect(typeAccepte(html, 'plan.pdf', 'document').ok).toBe(false);
  });

  it('refuse un .txt qui contient du balisage exécutable', () => {
    const svg = Buffer.from('<svg onload="alert(1)"></svg>');
    expect(detecterType(svg, 'notes.txt')).toBeNull();
  });

  it('accepte un vrai texte, et un CSV', () => {
    expect(detecterType(Buffer.from('Ligne 1\nLigne 2'), 'notes.txt')?.mime).toContain(
      'text/plain',
    );
    expect(detecterType(Buffer.from('a;b\n1;2'), 'export.csv')?.mime).toContain('text/csv');
  });

  it('reconnaît les photos de chantier : JPEG, PNG, HEIC', () => {
    expect(detecterType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'x.jpg')?.mime).toBe(
      'image/jpeg',
    );
    expect(
      detecterType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'x.png')?.mime,
    ).toBe('image/png');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]);
    expect(detecterType(heic, 'IMG_0421.HEIC')?.mime).toBe('image/heic');
  });

  it('reconnaît un plan DWG', () => {
    expect(detecterType(Buffer.from('AC1032'), 'rez.dwg')?.mime).toBe('image/vnd.dwg');
  });

  it('n’accepte un ZIP que s’il est un document bureautique', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(detecterType(zip, 'devis.docx')?.libelle).toBe('Word');
    // Une archive quelconque arriverait sans qu'on ait pu vérifier son contenu.
    expect(typeAccepte(zip, 'plans.zip', 'document').ok).toBe(false);
  });

  it('une facture est un PDF ou un scan — pas un fichier Excel', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    const r = typeAccepte(zip, 'facture.xlsx', 'facture');
    expect(r.ok).toBe(false);
    expect(typeAccepte(pdf, 'facture.pdf', 'facture').ok).toBe(true);
  });

  it('un fichier vide n’est rien', () => {
    expect(detecterType(Buffer.alloc(0), 'vide.pdf')).toBeNull();
  });
});

describe('Les en-têtes de l’API', () => {
  it('interdisent cadre, script et cache', () => {
    const e = entetesApi(false);
    expect(e['X-Frame-Options']).toBe('DENY');
    expect(e['Content-Security-Policy']).toContain("default-src 'none'");
    expect(e['Cache-Control']).toBe('no-store');
    expect(e['X-Content-Type-Options']).toBe('nosniff');
  });

  it('HSTS en production seulement — sur localhost, il piégerait le poste pour un an', () => {
    expect(entetesApi(false)['Strict-Transport-Security']).toBeUndefined();
    expect(entetesApi(true)['Strict-Transport-Security']).toContain('max-age=31536000');
  });
});
