/**
 * Limiteur de tentatives, par clé — un compte, une adresse, un défi MFA.
 *
 * Il ne compte que les **échecs**. Une connexion réussie ne consomme rien, et
 * remet le compteur du compte à zéro : un utilisateur qui se trompe deux fois
 * puis réussit ne doit pas traîner ses erreurs jusqu'au lendemain.
 *
 * En mémoire, donc propre à une instance de l'API. C'est suffisant tant que la
 * production tourne sur un seul serveur ; avec plusieurs instances, un
 * attaquant répartirait ses essais entre elles, et le compteur devra passer
 * dans Redis. La limite est écrite ici plutôt que découverte.
 */
export interface ReglesLimiteur {
  /** Nombre d'échecs tolérés dans la fenêtre. */
  max: number;
  fenetreMs: number;
  /** Durée du blocage une fois le seuil atteint. */
  blocageMs: number;
}

export type Verdict = { autorise: true } | { autorise: false; reessayerDansMs: number };

export class Limiteur {
  private readonly echecs = new Map<string, number[]>();
  private readonly bloques = new Map<string, number>();

  constructor(private readonly regles: ReglesLimiteur) {}

  verifier(cle: string, maintenant = Date.now()): Verdict {
    const jusqua = this.bloques.get(cle);
    if (jusqua !== undefined) {
      if (jusqua > maintenant) return { autorise: false, reessayerDansMs: jusqua - maintenant };
      this.bloques.delete(cle);
      this.echecs.delete(cle);
    }
    return { autorise: true };
  }

  /** Enregistre un échec ; renvoie le verdict qui en résulte. */
  echec(cle: string, maintenant = Date.now()): Verdict {
    const recents = (this.echecs.get(cle) ?? []).filter(
      (t) => maintenant - t < this.regles.fenetreMs,
    );
    recents.push(maintenant);
    this.echecs.set(cle, recents);

    if (recents.length >= this.regles.max) {
      this.bloques.set(cle, maintenant + this.regles.blocageMs);
      return { autorise: false, reessayerDansMs: this.regles.blocageMs };
    }
    this.nettoyer(maintenant);
    return { autorise: true };
  }

  reinitialiser(cle: string): void {
    this.echecs.delete(cle);
    this.bloques.delete(cle);
  }

  /** Borne la mémoire : sans ménage, chaque adresse essayée resterait à vie. */
  private nettoyer(maintenant: number): void {
    if (this.echecs.size < 10_000) return;
    for (const [cle, dates] of this.echecs) {
      if (dates.every((t) => maintenant - t >= this.regles.fenetreMs)) this.echecs.delete(cle);
    }
    for (const [cle, jusqua] of this.bloques) {
      if (jusqua <= maintenant) this.bloques.delete(cle);
    }
  }
}

const QUINZE_MINUTES = 15 * 60 * 1000;

/**
 * Les règles retenues.
 *
 * **Par compte**, c'est la barrière qui compte : cinq mots de passe faux en
 * quinze minutes bloquent le compte quinze minutes, d'où que viennent les
 * essais. La même clé est bloquée qu'elle corresponde ou non à un compte
 * existant — sinon le blocage lui-même révélerait quelles adresses existent.
 *
 * **Par adresse**, plus large : elle freine celui qui essaie un mot de passe
 * sur mille comptes, sans pénaliser un bureau entier derrière une même IP.
 *
 * **Le second facteur** a sa propre clé, par compte : six chiffres, c'est un
 * million de combinaisons, qu'on épuiserait vite sans elle.
 */
export const REGLES = {
  compte: { max: 5, fenetreMs: QUINZE_MINUTES, blocageMs: QUINZE_MINUTES },
  adresse: { max: 50, fenetreMs: QUINZE_MINUTES, blocageMs: QUINZE_MINUTES },
  mfa: { max: 5, fenetreMs: QUINZE_MINUTES, blocageMs: QUINZE_MINUTES },
} as const satisfies Record<string, ReglesLimiteur>;

export function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}
