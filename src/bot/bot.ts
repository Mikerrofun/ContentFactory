// Telegram-бот (точка входа). Голос/файлы → БД. Запуск: npm run bot.
import { Bot } from "grammy";
import { config } from "@/config/env";

export function createBot() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }
  return new Bot(config.TELEGRAM_BOT_TOKEN);
}