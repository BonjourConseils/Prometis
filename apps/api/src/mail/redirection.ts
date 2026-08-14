/**
 * Redirection des e-mails hors production.
 *
 * Tant que le produit n'est pas en production, aucun message ne doit partir
 * chez un vrai acquéreur, un vrai notaire ou une vraie entreprise. Toutes les
 * communications sont donc réacheminées vers une adresse unique, sans rien
 * perdre de l'information : le destinataire prévu passe en tête de l'objet, et
 * un bandeau récapitulatif est ajouté au corps.
 *
 * Fonction pure, sans dépendance à NestJS ni au transport : c'est ce qui la
 * rend testable directement, et c'est le seul endroit où la transformation
 * a lieu.
 */

export interface Message {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

export interface OptionsRedirection {
  /** Adresse unique qui reçoit tout. Vide = pas de redirection. */
  redirigerVers?: string;
  /** Affiché dans le bandeau, pour distinguer dev, test et recette. */
  environnement: string;
}

const enListe = (valeur: string | string[] | undefined): string[] =>
  valeur === undefined ? [] : Array.isArray(valeur) ? valeur : [valeur];

const joindre = (valeur: string | string[] | undefined): string =>
  enListe(valeur).join(', ') || '—';

/** Neutralise le HTML des valeurs insérées dans le bandeau. */
function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bandeauTexte(message: Message, environnement: string): string {
  return [
    '─────────────────────────────────────────────────────────────',
    ` MESSAGE REDIRIGÉ — environnement « ${environnement} »`,
    ' Ce message n’a PAS été envoyé à son destinataire réel.',
    '',
    ` Destinataire prévu : ${joindre(message.to)}`,
    ` Copie              : ${joindre(message.cc)}`,
    ` Copie cachée       : ${joindre(message.bcc)}`,
    ` Répondre à         : ${message.replyTo ?? '—'}`,
    ` Objet original     : ${message.subject}`,
    '─────────────────────────────────────────────────────────────',
    '',
    '',
  ].join('\n');
}

function bandeauHtml(message: Message, environnement: string): string {
  const ligne = (etiquette: string, valeur: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#6b665e;white-space:nowrap">${etiquette}</td>` +
    `<td style="padding:2px 0"><strong>${echapper(valeur)}</strong></td></tr>`;

  return [
    '<div style="border:1px solid #d8b48a;background:#fdf6ec;border-radius:8px;',
    'padding:14px 16px;margin:0 0 20px;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#1c1a17">',
    `<div style="font-weight:700;margin-bottom:8px">Message redirigé — environnement « ${echapper(environnement)} »</div>`,
    '<div style="color:#6b665e;margin-bottom:10px">Ce message n’a <strong>pas</strong> été envoyé à son destinataire réel.</div>',
    '<table style="border-collapse:collapse;font-size:13px">',
    ligne('Destinataire prévu', joindre(message.to)),
    ligne('Copie', joindre(message.cc)),
    ligne('Copie cachée', joindre(message.bcc)),
    ligne('Répondre à', message.replyTo ?? '—'),
    ligne('Objet original', message.subject),
    '</table>',
    '</div>',
  ].join('');
}

/**
 * Applique la redirection. Sans `redirigerVers`, le message ressort intact.
 *
 * L'objet devient : `[→ destinataire] Objet original`. Les copies et copies
 * cachées sont retirées — sinon elles partiraient vraiment.
 */
export function appliquerRedirection(message: Message, options: OptionsRedirection): Message {
  if (!options.redirigerVers) return message;

  const destinataires = enListe(message.to);
  const resume =
    destinataires.length === 0
      ? 'sans destinataire'
      : destinataires.length === 1
        ? destinataires[0]!
        : `${destinataires[0]!} +${destinataires.length - 1}`;

  return {
    to: options.redirigerVers,
    // cc/bcc volontairement absents : les conserver enverrait le message
    // aux vraies personnes, ce que la redirection cherche justement à éviter.
    subject: `[→ ${resume}] ${message.subject}`,
    replyTo: message.replyTo,
    text: message.text ? bandeauTexte(message, options.environnement) + message.text : undefined,
    html: message.html ? bandeauHtml(message, options.environnement) + message.html : undefined,
  };
}
