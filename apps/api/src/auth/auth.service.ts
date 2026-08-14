import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AppModule, SocieteProfil, UtilisateurRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext, type AuthenticatedCompte } from '../context/request-context';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

export interface WorkspaceSummary {
  membershipId: number;
  societeId: number;
  role: UtilisateurRole;
  fonction: string | null;
  acteurId: number | null;
  raisonSociale: string;
  profil: SocieteProfil;
  modulesActifs: AppModule[];
}

interface WorkspaceRow {
  membership_id: number;
  societe_id: number;
  role: UtilisateurRole;
  fonction: string | null;
  acteur_id: number | null;
  raison_sociale: string;
  profil: SocieteProfil;
  modules_actifs: AppModule[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantPrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Connexion par identifiants.
   *
   * `comptes` est l'une des deux tables sans policy RLS — et c'est nécessaire :
   * au moment du login, aucun tenant n'est encore connu. La table ne contient
   * aucune donnée métier, et rien n'en sort sans mot de passe valide.
   */
  async login(email: string, motDePasse: string) {
    const compte = await this.prisma.compte.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!compte || !compte.isActive) {
      // Vérification à vide : sans elle, un compte inexistant répondrait bien
      // plus vite qu'un mot de passe faux, ce qui permet d'énumérer les comptes.
      await this.password.verifyDummy(motDePasse);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    if (!(await this.password.verify(compte.passwordHash, motDePasse))) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    await this.prisma.compte.update({
      where: { id: compte.id },
      data: { lastLoginAt: new Date() },
    });

    const identite: AuthenticatedCompte = { compteId: compte.id, email: compte.email };
    const workspaces = await this.workspacesDe(compte.id);

    return {
      // Jeton d'identité seul : il ne donne accès à aucune donnée métier tant
      // qu'un espace de travail n'a pas été choisi.
      accessToken: this.tokens.signCompte(identite),
      compte: { id: compte.id, email: compte.email, prenom: compte.prenom, nom: compte.nom },
      workspaces,
    };
  }

  /**
   * Espaces de travail d'un compte.
   *
   * Passe par `app.memberships_du_compte`, une fonction SECURITY DEFINER :
   * la policy de `memberships` exige déjà un tenant, or c'est précisément ce
   * que l'utilisateur est en train de choisir. La fonction est scopée à un
   * seul compte et ne renvoie aucun secret.
   */
  async workspacesDe(compteId: number): Promise<WorkspaceSummary[]> {
    // Cast `::int` obligatoire : Prisma lie les entiers JavaScript en bigint,
    // et la fonction est déclarée avec des paramètres integer.
    const rows = await this.prisma.$queryRaw<WorkspaceRow[]>`
      SELECT * FROM app.memberships_du_compte(${compteId}::int)
    `;
    return rows.map((r) => ({
      membershipId: r.membership_id,
      societeId: r.societe_id,
      role: r.role,
      fonction: r.fonction,
      acteurId: r.acteur_id,
      raisonSociale: r.raison_sociale,
      profil: r.profil,
      modulesActifs: r.modules_actifs,
    }));
  }

  /** Entrer dans un espace de travail : délivre le jeton porteur du tenant. */
  async choisirWorkspace(compte: AuthenticatedCompte, societeId: number) {
    const rows = await this.prisma.$queryRaw<{ membership_id: number; role: UtilisateurRole }[]>`
      SELECT * FROM app.membership_actif(${compte.compteId}::int, ${societeId}::int)
    `;
    const membership = rows[0];

    if (!membership) {
      // Même message que pour une société inexistante : on ne confirme pas
      // l'existence d'un tenant auquel le compte n'appartient pas.
      throw new ForbiddenException("Cet espace de travail n'est pas accessible à ce compte.");
    }

    const workspace = {
      societeId,
      membershipId: membership.membership_id,
      role: membership.role,
    };

    return { accessToken: this.tokens.signWorkspace(compte, workspace), workspace };
  }

  /** Profil courant : identité, espace choisi, société et modules actifs. */
  async me() {
    const compte = RequestContext.requireCompte();
    const workspace = RequestContext.workspace();

    const base = {
      compte,
      workspaces: await this.workspacesDe(compte.compteId),
    };

    if (!workspace) {
      return { ...base, workspace: null, societe: null, membership: null };
    }

    const { societe, membership } = await this.tenantDb.run(async (tx) => ({
      societe: await tx.societe.findUniqueOrThrow({
        where: { id: workspace.societeId },
        select: {
          id: true,
          raisonSociale: true,
          profil: true,
          modulesActifs: true,
          canton: true,
          logoUrl: true,
        },
      }),
      membership: await tx.membership.findUniqueOrThrow({
        where: { id: workspace.membershipId },
        select: {
          id: true,
          role: true,
          fonction: true,
          acteur: { select: { id: true, societeNom: true, type: true } },
        },
      }),
    }));

    return { ...base, workspace, societe, membership };
  }
}
