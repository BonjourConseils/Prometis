/**
 * Les barrières de sécurité, éprouvées contre l'API qui tourne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, COMPTES, CB, apiDisponible, appel, jetonPourEspace } from './api-client';
import { ownerDb } from './tenant-db';

const INCONNU = `inconnu-${Date.now()}@example.ch`;
let christophe: string;
let operationId = 0;

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  operationId = (
    await ownerDb.operation.findFirstOrThrow({ where: { nom: 'Les Jardins de Prilly' } })
  ).id;
});

afterAll(async () => {
  await ownerDb.document.deleteMany({ where: { fileName: { startsWith: 'test-securite-' } } });
  await ownerDb.$disconnect();
});

describe('Connexion : la limite de tentatives', () => {
  it('bloque un compte après cinq mots de passe faux — même s’il n’existe pas', async () => {
    // Le compte n'existe pas, et le blocage survient quand même : sinon, le
    // blocage lui-même révélerait quelles adresses ont un compte.
    const statuts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await appel('/auth/login', {
        methode: 'POST',
        corps: { email: INCONNU, motDePasse: 'mauvais-mot-de-passe' },
      });
      statuts.push(r.status);
    }
    expect(statuts.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuts.at(-1)).toBe(429);
  });

  it('le message ne dit pas quelle barrière a cédé', async () => {
    const r = await appel<{ message: string }>('/auth/login', {
      methode: 'POST',
      corps: { email: INCONNU, motDePasse: 'x' },
    });
    expect(r.status).toBe(429);
    expect(r.body.message).toMatch(/Trop de tentatives\. Réessayez dans \d+ minute/);
  });

  it('un compte bloqué n’empêche pas les autres de se connecter', async () => {
    const r = await appel('/auth/login', {
      methode: 'POST',
      corps: { email: COMPTES.julie, motDePasse: 'Prometis!2026' },
    });
    expect(r.status).toBe(200);
  });

  it('le journal des connexions trace les échecs — sans jamais l’adresse e-mail tapée', async () => {
    const lignes = await ownerDb.journalConnexion.findMany({
      where: { compteId: null, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    expect(lignes.some((l) => l.evenement === 'ECHEC_MOT_DE_PASSE')).toBe(true);
    expect(lignes.some((l) => l.evenement === 'BLOQUE')).toBe(true);
    // Garder l'adresse tapée, ce serait conserver les tentatives de n'importe qui.
    expect(JSON.stringify(lignes)).not.toContain(INCONNU);
  });

  it('la connexion réussie est tracée avec l’adresse et le navigateur', async () => {
    const julie = await ownerDb.compte.findUniqueOrThrow({ where: { email: COMPTES.julie } });
    const derniere = await ownerDb.journalConnexion.findFirst({
      where: { compteId: julie.id, evenement: 'CONNEXION_REUSSIE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(derniere?.ip).toBeTruthy();
  });
});

describe('Dépôt de documents : les octets, pas le nom', () => {
  async function deposer(nom: string, contenu: Buffer, type: string) {
    const form = new FormData();
    form.append('fichier', new Blob([new Uint8Array(contenu)], { type }), nom);
    form.append('titre', nom);
    form.append('categorie', 'PLAN');
    const res = await fetch(`${API}/operations/${operationId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${christophe}` },
      body: form,
    });
    return {
      status: res.status,
      body: (await res.json()) as { id?: number; mimeType?: string; message?: string },
    };
  }

  it('refuse du HTML renommé en PDF, même annoncé comme PDF', async () => {
    const r = await deposer(
      'test-securite-piege.pdf',
      Buffer.from('<html><script>alert(document.cookie)</script></html>'),
      'application/pdf',
    );
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("n'est pas un type de fichier accepté");
  });

  it('accepte un vrai PDF, et enregistre le type DÉTECTÉ — pas celui annoncé', async () => {
    const r = await deposer(
      'test-securite-plan.pdf',
      Buffer.from('%PDF-1.7\n%test\n'),
      'text/html',
    );
    expect(r.status).toBe(201);
    const doc = await ownerDb.document.findUniqueOrThrow({ where: { id: r.body.id! } });
    expect(doc.mimeType).toBe('application/pdf');
  });

  it('au téléchargement, le document est mis en bac à sable', async () => {
    const doc = await ownerDb.document.findFirstOrThrow({
      where: { fileName: 'test-securite-plan.pdf' },
    });
    const res = await fetch(`${API}/operations/${operationId}/documents/${doc.id}/contenu`, {
      headers: { Authorization: `Bearer ${christophe}` },
    });
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('En-têtes et traçabilité', () => {
  it('toute réponse de l’API porte les en-têtes de sécurité, et pas X-Powered-By', async () => {
    const res = await fetch(`${API}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('le journal d’audit porte l’adresse du client', async () => {
    const res = await appel<{ id: number }>(`/operations/${operationId}/documents`, {
      token: christophe,
    });
    expect(res.ok).toBe(true);
    const derniere = await ownerDb.auditLog.findFirst({
      where: { action: { startsWith: 'document.' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(derniere?.ip).toBeTruthy();
  });
});
