import { Controller, Get } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestContext } from '../context/request-context';

/** La société courante — le tenant. Aucun `where` : la RLS ne laisse voir que lui. */
@Controller('societe')
export class SocieteController {
  constructor(private readonly tenantDb: TenantPrismaService) {}

  @Get()
  async courante() {
    const societeId = RequestContext.requireSocieteId();
    return this.tenantDb.run((tx) =>
      tx.societe.findUniqueOrThrow({
        where: { id: societeId },
        select: {
          id: true,
          raisonSociale: true,
          formeJuridique: true,
          ide: true,
          canton: true,
          localite: true,
          email: true,
          profil: true,
          modulesActifs: true,
          actionnaires: {
            select: { id: true, nom: true, partPct: true, fonction: true },
            orderBy: { partPct: 'desc' },
          },
        },
      }),
    );
  }
}
