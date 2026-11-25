// Запуск бота (long polling). TODO: хендлеры приёма контента.
import { createBot } from "./bot";

async function main() {
  const bot = createBot();
  bot.catch((err) => console.error("bot error", err));
  await bot.start();
  console.log("bot: started");
}

main();