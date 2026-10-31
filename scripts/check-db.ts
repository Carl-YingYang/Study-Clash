
import { PrismaClient } from "@prisma/client";

async function testConnection(
  name: string,
  url: string | undefined
) {
  if (!url) {
    console.error(`${name}: MISSING`);
    process.exitCode = 1;
    return;
  }

  const client = new PrismaClient({
    datasources: {
      db: { url },
    },
  });

  try {
    const result = await client.$queryRaw<
      Array<{ connection_test: number }>
    >`SELECT 1 AS connection_test`;

    console.log(`${name}: CONNECTED`, result);
  } catch (error) {
    console.error(
      `${name}: FAILED`,
      error instanceof Error ? error.message : error
    );

    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  await testConnection(
    "DATABASE_URL (Transaction Pooler)",
    process.env.DATABASE_URL
  );

  await testConnection(
    "DIRECT_URL (Session Pooler)",
    process.env.DIRECT_URL
  );
}

main().catch((error) => {
  console.error("Database test failed:", error);
  process.exitCode = 1;
});
