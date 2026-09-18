/**
 * Les modules commerciaux, contre l'API : ce que voit la société, ce que peut
 * l'exploitant, et ce qui reste après une résiliation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from '@node-rs/argon2';
import {
  API,
  COMPTES,
  CB,
  CONSTRUCTA,
  MOT_DE_PASSE,
  apiDisponible,
  appel,
  jetonPourEspace,
} from './api-client';
import { ownerDb } from './tenant-db';
import { codeTotp } from '../apps/api/src/auth/totp';

const MARQUE = 'test-modules';
const EXPLOITANT = `exploitant-${Date.now()}@example.ch`;
let exploitant = '';
let christophe = '';
let operationId = 0;

interface Etat {
  modules: { code: string; statut: string; eligible: boolean; finEssai: string | null }[];
  modulesActifs: string[];
  modulesLecture: string[];
}

async function changer(societeId: number, code: string, corps: Record<string, unknown>) {
  return appel<Etat & { message?: string }>(`/exploitant/societes/${societeId}/modules/${code}`, {
    methode: 'POST',
    token: exploitant,
    corps,
  });
}

beforeAll(async () => {
  if (!(await apiDisponible())) throw new Error(`API injoignable sur ${API}.`);
  christophe = await jetonPourEspace(COMPTES.christophe, CB);
  operationId = (
    await ownerDb.operation.findFirstOrThrow({ where: { nom: 'Les Jardins de Prilly' } })
  ).id;

  await ownerDb.compte.create({
    data: {
      email: EXPLOITANT,
      passwordHash: await hash(MOT_DE_PASSE),
      prenom: 'Test',
      nom: 'Exploitant',
    },
  });
  const login = await appel<{ accessToken: string }>('/auth/login', {
    methode: 'POST',
    corps: { email: EXPLOITANT, motDePasse: MOT_DE_PASSE },
  });
  exploitant = login.body.accessToken;
});

afterAll(async () => {
  // CB repart exactement comme le seed l'a laissée : trois modules actifs,
  // pas de passeport, et un historique sans nos passages.
  await ownerDb.souscriptionModule.deleteMany({ where: { societeId: CB, module: 'PASSEPORT' } });
  await ownerDb.souscriptionModule.updateMany({
    where: {
      societeId: CB,
      module: { in: ['APPELS_DE_FONDS', 'CONTROLE_FACTURES', 'APPELS_OFFRES'] },
    },
    data: { statut: 'ACTIF', finEssai: null, resilieLe: null },
  });
  await ownerDb.historiqueModule.deleteMany({ where: { raison: { contains: MARQUE } } });
  await ownerDb.auditLog.deleteMany({ where: { entite: 'SouscriptionModule' } });
  // Le recalcul à la lecture remet `modulesActifs` d'aplomb.
  await appel('/modules', { token: christophe });
  const compte = await ownerDb.compte.findUnique({ where: { email: EXPLOITANT } });
  if (compte) {
    await ownerDb.journalConnexion.deleteMany({ where: { compteId: compte.id } });
    await ownerDb.compte.delete({ where: { id: compte.id } });
  }
  await ownerDb.$disconnect();
});

describe('Ce que voit une société', () => {
  it('ses modules, et ceux qu’elle pourrait souscrire', async () => {
    const res = await appel<Etat>('/modules', { token: christophe });
    expect(res.ok).toBe(true);
    const parCode = Object.fromEntries(res.body.modules.map((m) => [m.code, m]));
    expect(parCode.APPELS_DE_FONDS!.statut).toBe('ACTIF');
    expect(parCode.PASSEPORT!.statut).toBe('NON_SOUSCRIT');
    expect(parCode.PASSEPORT!.eligible).toBe(true);
  });

  it('une entreprise générale voit les appels de fonds comme non éligibles', async () => {
    const marc = await jetonPourEspace(COMPTES.marc, CONSTRUCTA);
    const res = await appel<Etat>('/modules', { token: marc });
    expect(res.body.modules.find((m) => m.code === 'APPELS_DE_FONDS')!.eligible).toBe(false);
  });
});

describe('L’espace de l’exploitant', () => {
  it('refuse un client, même propriétaire de sa société', async () => {
    const res = await appel('/exploitant/societes', { token: christophe });
    expect(res.status).toBe(403);
  });

  it('refuse l’exploitant tant qu’il n’a pas de second facteur', async () => {
    await ownerDb.compte.update({ where: { email: EXPLOITANT }, data: { adminPlateforme: true } });
    const res = await appel<{ message: string }>('/exploitant/societes', { token: exploitant });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('second facteur');
  });

  it('l’ouvre une fois le second facteur actif — et ne montre aucun contenu client', async () => {
    const enrolement = await appel<{ secret: string }>('/auth/mfa/enrolement', {
      methode: 'POST',
      token: exploitant,
    });
    await appel('/auth/mfa/activer', {
      methode: 'POST',
      token: exploitant,
      corps: { code: codeTotp(enrolement.body.secret) },
    });

    const res = await appel<Record<string, unknown>[]>('/exploitant/societes', {
      token: exploitant,
    });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Nom, profil, modules — pas d'IBAN, pas d'adresse, rien de métier.
    expect(Object.keys(res.body[0]!).sort()).toEqual(
      ['id', 'modules_actifs', 'modules_lecture', 'profil', 'raison_sociale'].sort(),
    );
  });

  it('exige une raison écrite pour chaque geste', async () => {
    const res = await changer(CB, 'PASSEPORT', { statut: 'ACTIF', raison: 'court' });
    expect(res.status).toBe(400);
  });

  it('refuse la commercialisation à une entreprise générale', async () => {
    const res = await changer(CONSTRUCTA, 'APPELS_DE_FONDS', {
      statut: 'ACTIF',
      raison: `${MARQUE} : tentative sur un profil non éligible`,
    });
    expect(res.status).toBe(400);
  });

  it('met un module à l’essai, avec sa date de fin', async () => {
    const fin = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await changer(CB, 'PASSEPORT', {
      statut: 'ESSAI',
      finEssai: fin,
      raison: `${MARQUE} : essai de démonstration du passeport`,
    });
    expect(res.status).toBe(200);
    expect(res.body.modulesActifs).toContain('PASSEPORT');
  });

  it('inscrit le geste dans l’historique, avec son auteur et sa raison', async () => {
    const ligne = await ownerDb.historiqueModule.findFirstOrThrow({
      where: { societeId: CB, module: 'PASSEPORT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ligne.vers).toBe('ESSAI');
    expect(ligne.raison).toContain(MARQUE);
    expect(ligne.parCompteId).not.toBeNull();
  });
});

describe('Résilier ne détruit rien', () => {
  it('un module résilié reste lisible', async () => {
    const res = await changer(CB, 'APPELS_OFFRES', {
      statut: 'RESILIE',
      raison: `${MARQUE} : résiliation pour éprouver la lecture seule`,
    });
    expect(res.status).toBe(200);
    expect(res.body.modulesLecture).toContain('SOUMISSIONS');
    // CONTRATS est aussi porté par le contrôle des factures, toujours actif.
    expect(res.body.modulesActifs).toContain('CONTRATS');

    const lecture = await appel(`/operations/${operationId}/soumissions`, { token: christophe });
    expect(lecture.status).toBe(200);
  });

  it('mais ne se modifie plus — et le refus dit pourquoi', async () => {
    const cfc = await ownerDb.cfcNode.findFirstOrThrow({ where: { operationId, code: '271' } });
    const res = await appel<{ message: string }>(`/operations/${operationId}/soumissions`, {
      methode: 'POST',
      token: christophe,
      corps: { cfcNodeId: cfc.id, objet: 'Ne doit pas passer' },
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('résilié');
  });

  it('un essai échu se ferme de lui-même, sans tâche planifiée', async () => {
    // On avance la fin d'essai dans le passé, directement en base : c'est ce
    // que ferait le temps. Aucun traitement ne tourne entre-temps.
    await ownerDb.souscriptionModule.update({
      where: { societeId_module: { societeId: CB, module: 'PASSEPORT' } },
      data: { finEssai: new Date(Date.now() - 60_000) },
    });
    // La navigation — `/auth/me` — est le premier écran qui doit le savoir.
    const me = await appel<{ societe: { modulesActifs: string[]; modulesLecture: string[] } }>(
      '/auth/me',
      { token: christophe },
    );
    expect(me.body.societe.modulesActifs).not.toContain('PASSEPORT');
    expect(me.body.societe.modulesLecture).toContain('PASSEPORT');

    // Et la page « Mes modules » ne dit plus « essai » en cours.
    const etat = await appel<Etat>('/modules', { token: christophe });
    expect(etat.body.modulesActifs).not.toContain('PASSEPORT');
  });
});
