import { dateSuisse, francs } from './regles';

/**
 * Les e-mails de facturation — texte seul, une fonction par événement.
 *
 * Stripe envoie la facture ; Prometis explique ce que la société a obtenu.
 * Chaque message dit en bas pourquoi il arrive. Pas de marketing par ce canal.
 */

export interface Courriel {
  subject: string;
  text: string;
}

const PIED = (raison: string) =>
  `\n\n—\nVous recevez ce message parce que vous administrez ${raison} dans Prometis. ` +
  'Il concerne votre abonnement ; il ne contient aucune offre commerciale.';

export function essaiDemarre(p: {
  societe: string;
  modules: string[];
  finEssai: Date;
  montantEnsuite: number | null;
}): Courriel {
  return {
    subject: `Prometis — votre essai a commencé (jusqu’au ${dateSuisse(p.finEssai)})`,
    text:
      `Bonjour,\n\nL’essai de ${p.societe} est ouvert : ${p.modules.join(', ')}.\n\n` +
      `Prélevé aujourd’hui : rien.\n` +
      `Fin de l’essai : ${dateSuisse(p.finEssai)}.\n` +
      (p.montantEnsuite != null
        ? `Ensuite : ${francs(p.montantEnsuite)} par mois, TVA comprise, sauf annulation.\n`
        : '') +
      `\nVous serez prévenu trois jours avant le premier prélèvement. Pour annuler, ` +
      `ouvrez Prometis → Modules : rien ne sera prélevé si vous annulez avant la fin de l’essai.` +
      PIED(p.societe),
  };
}

export function finEssaiProche(p: {
  societe: string;
  finEssai: Date;
  montant: number | null;
  annule: boolean;
}): Courriel {
  if (p.annule) {
    return {
      subject: `Prometis — votre essai se termine le ${dateSuisse(p.finEssai)}`,
      text:
        `Bonjour,\n\nL’essai de ${p.societe} se termine le ${dateSuisse(p.finEssai)}. ` +
        `Vous l’avez annulé : rien ne sera prélevé. Vos données restent consultables ` +
        `après cette date, en lecture seule.` +
        PIED(p.societe),
    };
  }
  return {
    subject: `Prometis — premier prélèvement le ${dateSuisse(p.finEssai)}`,
    text:
      `Bonjour,\n\nL’essai de ${p.societe} se termine le ${dateSuisse(p.finEssai)}.\n\n` +
      (p.montant != null
        ? `À cette date, ${francs(p.montant)} (TVA comprise) seront prélevés, sauf annulation.\n`
        : `À cette date, le premier mois sera prélevé, sauf annulation.\n`) +
      `\nPour annuler : Prometis → Modules → « Résilier ». Jusqu’à la veille, rien n’est prélevé ; ` +
      `vos données restent consultables en lecture seule.` +
      PIED(p.societe),
  };
}

export function abonnementConfirme(p: {
  societe: string;
  modules: string[];
  finPeriode: Date | null;
}): Courriel {
  return {
    subject: 'Prometis — abonnement confirmé',
    text:
      `Bonjour,\n\nL’abonnement de ${p.societe} est confirmé : ${p.modules.join(', ')}.\n` +
      (p.finPeriode ? `Prochaine échéance : ${dateSuisse(p.finPeriode)}.\n` : '') +
      `\nLe reçu vous est envoyé par Stripe, notre prestataire de paiement. ` +
      `Pour résilier un module : Prometis → Modules ; il reste ouvert jusqu’à l’échéance payée.` +
      PIED(p.societe),
  };
}
