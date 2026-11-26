const type = process.argv[2] ?? "fact";

const loaders: Record<string, () => Promise<unknown>> = {
  fact: () => import("./fact/load"),
  case: () => import("./case/load"),
};

const run = loaders[type];
if (!run) {
  console.error(`[load] тип "${type}" не реализован (доступен: fact, case)`);
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});