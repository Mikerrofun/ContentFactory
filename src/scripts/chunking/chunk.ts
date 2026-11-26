import { runFactChunker } from "./fact/chunk";

function main() {
  const type = process.argv[2] ?? "fact";
  switch (type) {
    case "fact": {
      const { report } = runFactChunker();
      console.log(`[chunk] fact: ${report.total} чанков`);
      for (const [src, n] of Object.entries(report.bySource)) console.log(`  ${src}: ${n}`);
      break;
    }
    default:
      console.error(`[chunk] тип "${type}" не реализован (доступен: fact)`);
      process.exit(1);
  }
}

main();