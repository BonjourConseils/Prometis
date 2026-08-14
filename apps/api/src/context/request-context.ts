import { AsyncLocalStorage } from 'node:async_hooks';
import type { UtilisateurRole } from '@prisma/client';

/** Le compte authentifié — l'identité, indépendante de toute société. */
export interface AuthenticatedCompte {
  compteId: number;
  email: string;
}

/**
 * L'espace de travail choisi : le tenant courant et le rôle qu'y a le compte.
 * Absent tant que l'utilisateur n'a pas choisi une société — un compte peut
 * appartenir à plusieurs.
 */
export interface Workspace {
  societeId: number;
  membershipId: number;
  role: UtilisateurRole;
}

export interface RequestStore {
  compte?: AuthenticatedCompte;
  workspace?: Workspace;
}

const storage = new AsyncLocalStorage<RequestStore>();

/**
 * Contexte de la requête courante.
 *
 * Il n'est *pas* la sécurité : la sécurité des données est la policy RLS en
 * base, et celle des actions est le RBAC. Ce contexte transporte l'identité
 * et le tenant jusqu'à la couche qui pose `app.societe_id`.
 */
export const RequestContext = {
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  get(): RequestStore | undefined {
    return storage.getStore();
  },

  compte(): AuthenticatedCompte | undefined {
    return storage.getStore()?.compte;
  },

  workspace(): Workspace | undefined {
    return storage.getStore()?.workspace;
  },

  requireCompte(): AuthenticatedCompte {
    const compte = storage.getStore()?.compte;
    if (!compte) throw new Error('Aucun compte authentifié dans le contexte de la requête.');
    return compte;
  },

  requireWorkspace(): Workspace {
    const workspace = storage.getStore()?.workspace;
    if (!workspace) {
      throw new Error(
        'Aucun espace de travail dans le contexte : le jeton ne porte pas de société. ' +
          'Appeler POST /auth/workspace, ou marquer la route @NoWorkspace().',
      );
    }
    return workspace;
  },

  /** Le tenant courant, pour `SET LOCAL app.societe_id`. */
  requireSocieteId(): number {
    return RequestContext.requireWorkspace().societeId;
  },
};
