import { runFactChunker } from "./fact/chunk";
import { runCaseChunker } from "./case/chunk";
import { runBestChunker } from "./best/chunk";

function main() {
  const type = process.argv[2] ?? "fact";
  switch (type) {
    case "fact": {
      const { report } = runFactChunker();
      console.log(`[chunk] fact: ${report.total} чанков`);
      for (const [src, n] of Object.entries(report.bySource)) console.log(`  ${src}: ${n}`);
      break;
    }
    case "case": {
      const { report } = runCaseChunker();
      console.log(`[chunk] case: ${report.total} чанков`);
      for (const [src, n] of Object.entries(report.bySource)) console.log(`  ${src}: ${n}`);
      break;
    }
    case "best": {
      const { report } = runBestChunker();
      console.log(`[chunk] best: ${report.total} чанков`);
      for (const [src, n] of Object.entries(report.bySource)) console.log(`  ${src}: ${n}`);
      break;
    }
    default:
      console.error(`[chunk] тип "${type}" не реализован (доступен: fact, case, best)`);
      process.exit(1);
  }
}

main();