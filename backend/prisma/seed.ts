// Seed executado por `pnpm prisma db seed` (e após `migrate reset`):
//  1. cultivares de referência do sistema (sempre);
//  2. administrador inicial a partir de ADMIN_EMAIL e ADMIN_PASSWORD (se definidas).
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env';
import { passwordSchema } from '../src/modules/auth/dtos/password.schema';
import { cultivarParamsSchema } from '../src/modules/cultivars/dtos/cultivar-params.schema';
import { REFERENCE_CULTIVARS } from '../src/modules/cultivars/reference-cultivars';

const BCRYPT_ROUNDS = 12;

const prisma = new PrismaClient();

async function seedCultivars(): Promise<void> {
  for (const { name, crop, cycleDescription, ...params } of REFERENCE_CULTIVARS) {
    // O seed não pode introduzir valores que a API rejeitaria.
    const parsed = cultivarParamsSchema.safeParse(params);
    if (!parsed.success) {
      const reasons = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Cultivar de referência "${name}" inválida: ${reasons}`);
    }

    // Idempotente por name + crop entre as de referência (createdById nulo
    // torna a unicidade do banco inoperante para elas).
    const existing = await prisma.cultivar.findFirst({ where: { name, crop, isDefault: true } });
    if (existing) {
      await prisma.cultivar.update({
        where: { id: existing.id },
        data: { cycleDescription, ...parsed.data },
      });
    } else {
      await prisma.cultivar.create({
        data: { name, crop, cycleDescription, ...parsed.data, isDefault: true, createdById: null },
      });
    }
    console.log(`[seed] Cultivar de referência ${existing ? 'atualizada' : 'criada'}: ${name}`);
  }
}

async function seedAdmin(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.log('[seed] ADMIN_EMAIL e ADMIN_PASSWORD não definidas; nenhum administrador criado.');
    return;
  }

  const password = passwordSchema.safeParse(env.ADMIN_PASSWORD);
  if (!password.success) {
    const reasons = password.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`ADMIN_PASSWORD inválida: ${reasons}`);
  }

  const email = env.ADMIN_EMAIL;
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const existing = await prisma.user.findUnique({ where: { email } });

  // Idempotente por e-mail: repetir o seed atualiza a senha e garante o role.
  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: 'Administrador',
      role: 'ADMIN',
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
    update: {
      role: 'ADMIN',
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: existing?.emailVerifiedAt ?? new Date(),
    },
  });

  console.log(`[seed] Administrador ${existing ? 'atualizado' : 'criado'}: ${admin.email}`);
}

seedCultivars()
  .then(seedAdmin)
  .catch((error) => {
    console.error('[seed]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
