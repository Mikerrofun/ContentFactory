const type = process.argv[2] ?? "fact";

const loaders: Record<string, () => Promise<unknown>> = {
  fact: () => import("./fact/load"),
  case: () => import("./case/load"),
  best: () => import("./best/load"),
};

const run = loaders[type];
if (!run) {
  console.error(`[load] тип "${type}" не реализован (доступен: fact, case, best)`);
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});