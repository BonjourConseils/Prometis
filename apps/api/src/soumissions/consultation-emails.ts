/**
 * Les e-mails de la consultation — texte seul. Tous partent par `MailService`,
 * donc tous sont redirigés hors production.
 *
 * Chacun dit pourquoi il arrive et à qui répondre ; aucun ne porte de montant
 * ni le nom d'un autre soumissionnaire.
 */

interface Courriel {
  subject: string;
  text: string;
}

const dateHeure = (d: Date) =>
  d.toLocaleString('fr-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  });

const PIED = (promoteur: string) =>
  `\n\n—\nVous recevez ce message parce que ${promoteur} a invité votre entreprise à cette consultation ` +
  'dans Prometis. Si vous pensez l’avoir reçu par erreur, ignorez-le : le lien ne fonctionne qu’avec ' +
  'un code envoyé à cette même adresse.';

export function invitation(p: {
  promoteur: string;
  operation: string;
  commune: string | null;
  intitule: string;
  dateLimite: Date;
  contact: string | null;
  lien: string;
}): Courriel {
  return {
    subject: `Appel d’offres — ${p.intitule} (${p.operation})`,
    text:
      `${p.contact ? `Bonjour ${p.contact},` : 'Bonjour,'}\n\n` +
      `${p.promoteur} vous invite à remettre une offre pour « ${p.intitule} », ` +
      `promotion ${p.operation}${p.commune ? ` à ${p.commune}` : ''}.\n\n` +
      `Date limite de remise : ${dateHeure(p.dateLimite)}.\n\n` +
      `Le dossier, les questions et le dépôt de votre offre se trouvent ici :\n${p.lien}\n\n` +
      'À l’ouverture, un code à six chiffres vous est envoyé à cette adresse. Ce lien vous est ' +
      'personnel : ne le transférez pas.\n\n' +
      'Vous pouvez aussi décliner l’invitation depuis cette page.' +
      PIED(p.promoteur),
  };
}

export function code(p: { promoteur: string; intitule: string; code: string }): Courriel {
  return {
    subject: `Votre code d’accès — ${p.intitule}`,
    text:
      `Votre code : ${p.code}\n\nIl est valable 15 minutes et ne sert qu’une fois. ` +
      'Si vous n’avez pas demandé ce code, ignorez ce message : sans lui, personne n’accède au dossier.' +
      PIED(p.promoteur),
  };
}

export function accuseReception(p: {
  promoteur: string;
  intitule: string;
  deposeeLe: Date;
  dateLimite: Date | null;
}): Courriel {
  return {
    subject: `Offre reçue — ${p.intitule}`,
    text:
      `Votre offre pour « ${p.intitule} » a bien été reçue le ${dateHeure(p.deposeeLe)}.\n\n` +
      (p.dateLimite
        ? `Vous pouvez la modifier jusqu’au ${dateHeure(p.dateLimite)}. Elle reste scellée jusque-là : ` +
          `${p.promoteur} voit qu’elle est arrivée, pas son contenu.`
        : '') +
      PIED(p.promoteur),
  };
}

export function relance(p: {
  promoteur: string;
  operation: string;
  intitule: string;
  dateLimite: Date;
}): Courriel {
  return {
    subject: `Rappel — offre attendue d’ici le ${dateHeure(p.dateLimite)}`,
    text:
      `Bonjour,\n\nLa date limite de remise des offres pour « ${p.intitule} » (${p.operation}) est ` +
      `fixée au ${dateHeure(p.dateLimite)}. Nous n’avons pas encore reçu votre offre.\n\n` +
      'Le lien reçu avec l’invitation reste valable. Vous pouvez aussi y décliner l’invitation.' +
      PIED(p.promoteur),
  };
}

export function avisSoumissionnaires(p: {
  promoteur: string;
  operation: string;
  intitule: string;
  sujet: string;
  corps: string;
}): Courriel {
  return {
    subject: `${p.sujet} — ${p.intitule}`,
    text:
      `Bonjour,\n\nAvis à tous les soumissionnaires de « ${p.intitule} » (${p.operation}) :\n\n` +
      `${p.corps}\n\nCe message est adressé dans les mêmes termes à toutes les entreprises consultées.` +
      PIED(p.promoteur),
  };
}
