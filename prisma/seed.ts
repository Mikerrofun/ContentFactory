// Prisma seed — точка входа наполнения БД (заполняется позже).
import { prisma } from "../src/db/prisma";

async function main() {
  // TODO: seed чанков/эталонов при подключении источников.
  console.log("seed: ok (empty)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());