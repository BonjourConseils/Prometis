import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ZodType } from 'zod';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { adapterRequete, configFournisseur, coutMilliemes } from './fournisseur';

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
    const config = configFournisseur();
    if (!config) {
      // Pas de nom de variable d'environnement dans le message : c'est de la
      // configuration serveur, elle n'aide en rien l'utilisateur.
      throw new ServiceUnavailableException(
        'La proposition automatique n’est pas disponible sur ce serveur. La saisie manuelle reste possible.',
      );
    }

    const corps = adapterRequete(
      {
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
      },
      config.modele,
    );

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
        throw new Error(`Infomaniak a répondu ${reponse.status} : ${texte.slice(0, 200)}`);
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

      await this.journaliser(
        societeId,
        usage,
        config.modele,
        debut,
        true,
        tokensEntree,
        tokensSortie,
      );
      return analyse.data;
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      this.logger.error(`Appel IA « ${usage} » en échec : ${message}`);
      await this.journaliser(
        societeId,
        usage,
        config.modele,
        debut,
        false,
        tokensEntree,
        tokensSortie,
        message,
      );
      throw new ServiceUnavailableException(
        'La proposition automatique a échoué. Réessayez, ou saisissez les équipements à la main.',
      );
    }
  }

  private async journaliser(
    societeId: number,
    usage: string,
    modele: string,
    debut: number,
    succes: boolean,
    tokensEntree?: number,
    tokensSortie?: number,
    erreur?: string,
  ): Promise<void> {
    try {
      await this.db.runInTenant(societeId, (tx) =>
        tx.appelIa.create({
          data: {
            societeId,
            usage,
            modele,
            tokensEntree: tokensEntree ?? null,
            tokensSortie: tokensSortie ?? null,
            coutMilliemes:
              tokensEntree !== undefined && tokensSortie !== undefined
                ? coutMilliemes(modele, tokensEntree, tokensSortie)
                : null,
            dureeMs: Date.now() - debut,
            succes,
            erreur: erreur?.slice(0, 500) ?? null,
          },
        }),
      );
    } catch (e) {
      this.logger.error(`Journal IA non écrit : ${String(e)}`);
    }
  }
}
