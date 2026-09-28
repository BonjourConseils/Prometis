import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ZodType } from 'zod';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { adapterRequete, configFournisseur } from './fournisseur';
import { coutAppel, coutEnCredits, etagePour, type Etage } from './couts';
import { configOllama } from './ollama';

const DELAI_MS = 90_000;

/**
 * Le seul point de passage vers l'IA — comme `MailService` pour les e-mails.
 *
 * Trois règles (skill `securite-saas`, §6) :
 *   · **le contenu d'un document est une donnée, jamais une instruction** —
 *     c'est à l'appelant de le délimiter comme tel dans le prompt ;
 *   · **la sortie est contrainte** par un schéma JSON côté fournisseur, puis
 *     revalidée par zod côté serveur : un modèle ne décide d'aucune forme ;
 *   · **le modèle n'agit sur rien** : il rend des propositions, qu'un humain
 *     valide avant qu'elles existent dans le produit.
 *
 * Chaque appel est journalisé avec le modèle **réellement envoyé**, ses tokens
 * et son coût estimé — sans cela, le coût du fournisseur ne se lit nulle part.
 */
@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(private readonly db: TenantPrismaService) {}

  get disponible(): boolean {
    return configFournisseur() !== null;
  }

  async completerJson<T>(
    societeId: number,
    usage: string,
    options: {
      systeme: string;
      utilisateur: string;
      schemaJson: Record<string, unknown>;
      schema: ZodType<T>;
      maxTokens?: number;
    },
  ): Promise<T> {
    // La table de routage décide de l'étage ; l'appelant ne choisit pas.
    // Une opération confiée au modèle local retombe sur l'étage suisse quand
    // le serveur n'a pas d'Ollama — et c'est l'étage réellement appelé qui
    // est journalisé, jamais celui qui était prévu.
    const local = etagePour(usage) === 'LOCAL' ? configOllama() : null;
    const config = local
      ? { apiKey: 'ollama', baseURL: `${local.baseURL}/v1`, modele: local.modele }
      : configFournisseur();
    if (!config) {
      // Pas de nom de variable d'environnement dans le message : c'est de la
      // configuration serveur, elle n'aide en rien l'utilisateur.
      throw new ServiceUnavailableException(
        'La proposition automatique n’est pas disponible sur ce serveur. La saisie manuelle reste possible.',
      );
    }
    const etage: Etage = local ? 'LOCAL' : 'PUISSANT';

    const requete = {
      messages: [
        { role: 'system', content: options.systeme },
        { role: 'user', content: options.utilisateur },
      ],
      max_tokens: options.maxTokens ?? 4000,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'reponse', strict: true, schema: options.schemaJson },
      },
    };
    // Ollama parle le même dialecte, sans les adaptations d'Infomaniak ; il
    // lui faut en revanche sa fenêtre de contexte, sans quoi il tronque le
    // texte en silence et rend des champs nuls.
    const corps = local
      ? { ...requete, model: local.modele, options: { num_ctx: local.numCtx } }
      : adapterRequete(requete, config.modele);

    const debut = Date.now();
    let tokensEntree: number | undefined;
    let tokensSortie: number | undefined;
    try {
      const reponse = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      const texte = await reponse.text();
      if (!reponse.ok) {
        throw new Error(
          `${local ? 'Le modèle local' : 'Infomaniak'} a répondu ${reponse.status} : ${texte.slice(0, 200)}`,
        );
      }
      const json = JSON.parse(texte) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      tokensEntree = json.usage?.prompt_tokens;
      tokensSortie = json.usage?.completion_tokens;

      const contenu = json.choices?.[0]?.message?.content ?? '';
      const analyse = options.schema.safeParse(JSON.parse(contenu));
      if (!analyse.success) {
        throw new Error(
          `Réponse hors schéma : ${analyse.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join(' · ')}`,
        );
      }

      await this.journaliser({
        societeId,
        usage,
        etage,
        modele: config.modele,
        debut,
        succes: true,
        tokensEntree,
        tokensSortie,
      });
      return analyse.data;
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      this.logger.error(`Appel IA « ${usage} » en échec : ${message}`);
      await this.journaliser({
        societeId,
        usage,
        etage,
        modele: config.modele,
        debut,
        succes: false,
        tokensEntree,
        tokensSortie,
        erreur: message,
      });
      throw new ServiceUnavailableException(
        'La proposition automatique a échoué. Réessayez, ou saisissez les équipements à la main.',
      );
    }
  }

  /**
   * Écrit une ligne par appel, réussi ou non — et **jamais bloquant** : un
   * journal qui échoue ne fait pas échouer une action réussie.
   *
   * Des compteurs, jamais de contenu : ni le texte envoyé, ni la réponse.
   */
  async journaliser(entree: {
    societeId: number;
    usage: string;
    etage: Etage;
    modele: string;
    debut: number;
    succes: boolean;
    tokensEntree?: number;
    tokensSortie?: number;
    requetes?: number;
    erreur?: string;
  }): Promise<void> {
    // Un échec ne coûte pas de crédits : il est journalisé, pas facturé.
    const cout = entree.succes
      ? coutAppel(
          entree.modele,
          entree.tokensEntree ?? 0,
          entree.tokensSortie ?? 0,
          entree.requetes ?? 1,
        )
      : null;
    if (entree.succes && !cout) {
      // Bruyant, volontairement : un modèle sans tarif sous-facture en silence.
      this.logger.warn(`Modèle « ${entree.modele} » absent de la table de prix : coût inconnu.`);
    }
    try {
      await this.db.runInTenant(entree.societeId, (tx) =>
        tx.appelIa.create({
          data: {
            societeId: entree.societeId,
            usage: entree.usage,
            etage: entree.etage,
            fournisseur: cout?.fournisseur ?? fournisseurDe(entree.etage),
            modele: entree.modele,
            tokensEntree: entree.tokensEntree ?? null,
            tokensSortie: entree.tokensSortie ?? null,
            requetes: entree.requetes ?? (entree.etage === 'RECHERCHE' ? 1 : 0),
            cout: cout ? cout.montant.toFixed(6) : null,
            devise: cout?.devise ?? 'CHF',
            credits: coutEnCredits(cout),
            dureeMs: Date.now() - entree.debut,
            succes: entree.succes,
            erreur: entree.erreur?.slice(0, 500) ?? null,
          },
        }),
      );
    } catch (e) {
      this.logger.error(`Journal IA non écrit : ${String(e)}`);
    }
  }
}

function fournisseurDe(etage: Etage): string {
  return etage === 'LOCAL' ? 'ollama' : etage === 'RECHERCHE' ? 'perplexity' : 'infomaniak';
}
