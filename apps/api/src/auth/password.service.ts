import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hachage des mots de passe en argon2id.
 *
 * Frontière volontairement étroite : le jour où l'authentification passe à
 * OIDC (Keycloak ou fournisseur suisse), c'est ce service qui disparaît, pas
 * le RBAC ni le contexte tenant.
 */
@Injectable()
export class PasswordService {
  // Paramètres OWASP pour argon2id (19 MiB, 2 passes, parallélisme 1).
  private readonly options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

  async hash(motDePasse: string): Promise<string> {
    return hash(motDePasse, this.options);
  }

  /**
   * Vérification contre une empreinte factice, au coût identique à une vraie.
   *
   * Sans elle, un e-mail inconnu répondrait sans faire de calcul argon2, donc
   * bien plus vite qu'un mot de passe faux : la différence de temps suffit à
   * énumérer les comptes existants.
   */
  async verifyDummy(motDePasse: string): Promise<void> {
    this.empreinteFactice ??= this.hash('empreinte-factice-egalisation-du-temps-de-reponse');
    await this.verify(await this.empreinteFactice, motDePasse);
  }

  private empreinteFactice?: Promise<string>;

  async verify(empreinte: string, motDePasse: string): Promise<boolean> {
    try {
      return await verify(empreinte, motDePasse, this.options);
    } catch {
      // Empreinte illisible (format inconnu, seed non migré) : on refuse,
      // on ne lève pas — une erreur 500 sur un login révèle l'anomalie à
      // l'attaquant.
      return false;
    }
  }
}
