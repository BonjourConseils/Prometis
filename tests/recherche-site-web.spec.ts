/**
 * Préremplir une fiche depuis un site web — les garde-fous.
 *
 * L'URL vient d'un formulaire, et c'est le **serveur** qui va la chercher :
 * il se trouve derrière le pare-feu, devant la base et les services internes.
 * Ce fichier existe pour que `http://localhost:5432` ne parte jamais.
 */
import { describe, expect, it } from 'vitest';
import {
  UrlRefusee,
  adressePrivee,
  normaliserUrl,
  texteDuHtml,
} from '../apps/api/src/recherche/site-web';

describe('normalisation de l’adresse', () => {
  it('complète le protocole, comme les gens l’écrivent', () => {
    expect(normaliserUrl('probatec.ch').toString()).toBe('https://probatec.ch/');
    expect(normaliserUrl(' www.probatec.ch/contact ').toString()).toBe(
      'https://www.probatec.ch/contact',
    );
  });

  it('refuse ce qui n’est pas un site', () => {
    for (const brut of ['', 'ftp://exemple.ch', 'file:///etc/passwd', 'localhost', 'pas une url']) {
      expect(() => normaliserUrl(brut)).toThrow(UrlRefusee);
    }
  });

  it('refuse `javascript:` et les schémas exotiques', () => {
    expect(() => normaliserUrl('javascript:alert(1)')).toThrow(UrlRefusee);
    expect(() => normaliserUrl('data:text/html,<h1>x')).toThrow(UrlRefusee);
  });
});

describe('adresses que le serveur ne doit pas aller chercher', () => {
  it('boucle locale, réseaux privés, métadonnées de l’hébergeur', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.7',
      '172.16.3.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(adressePrivee(ip), ip).toBe(true);
    }
  });

  it('laisse passer une adresse publique', () => {
    for (const ip of ['185.19.28.10', '8.8.8.8', '2001:db8::1', '172.32.0.1', '192.167.1.1']) {
      expect(adressePrivee(ip), ip).toBe(false);
    }
  });
});

describe('texte d’une page', () => {
  const html = `<!doctype html><html><head><title>Probatec Sàrl</title>
    <meta name="description" content="Direction des travaux, Monthey">
    <style>.a{color:red}</style><script>var x = 1;</script></head>
    <body><h1>Probatec</h1><p>Rue de Venise 3A<br>1870 Monthey</p>
    <!-- caché --><p>T&eacute;l. 024 471 00 00 &amp; info@probatec.ch</p></body></html>`;

  it('garde le titre, la description et le corps', () => {
    const texte = texteDuHtml(html);
    expect(texte).toContain('Probatec Sàrl');
    expect(texte).toContain('Direction des travaux, Monthey');
    expect(texte).toContain('Rue de Venise 3A');
    expect(texte).toContain('1870 Monthey');
  });

  it('écarte les scripts, les styles et les commentaires', () => {
    const texte = texteDuHtml(html);
    expect(texte).not.toContain('var x');
    expect(texte).not.toContain('color:red');
    expect(texte).not.toContain('caché');
  });

  it('rend les entités lisibles', () => {
    expect(texteDuHtml(html)).toContain('Tél. 024 471 00 00 & info@probatec.ch');
  });

  it('borne la longueur : une page n’est pas un livre', () => {
    expect(texteDuHtml(`<p>${'a'.repeat(50_000)}</p>`, 500)).toHaveLength(500);
  });
});
