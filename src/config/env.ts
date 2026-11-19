import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHANNEL_ID: z.string().optional().default(""),
  MEXC_API_KEY: z.string().optional().default(""),
  MEXC_API_SECRET: z.string().optional().default(""),
  BINANCE_API_KEY: z.string().optional().default(""),
  BINANCE_API_SECRET: z.string().optional().default(""),
  COINGECKO_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default("")
});

export const env = envSchema.parse(process.env);
