import fs from "fs";
import path from "path";

export type PlanTier = "FREE" | "PRO" | "VIP";
export type RiskProfile = "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";

export interface PlanDefinition {
  tier: PlanTier;
  titleUz: string;
  priceStars: number;
  priceUsdApprox: number;
  billingCycleUz: string;
  featuresUz: string[];
}

export interface SubscriberRecord {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  tier: PlanTier;
  riskProfile: RiskProfile;
  createdAt: string;
  updatedAt: string;
}

export const SUBSCRIPTION_PLANS: PlanDefinition[] = [
  {
    tier: "FREE",
    titleUz: "Free (Sinov)",
    priceStars: 0,
    priceUsdApprox: 0,
    billingCycleUz: "Bepul",
    featuresUz: [
      "Ochiq jonli Web Dashboard statistikasi",
      "Haftalik Demo Portfel PDF hisoboti",
      "Bot orqali bozor holati va Win Rate ko'rish"
    ]
  },
  {
    tier: "PRO",
    titleUz: "Pro (Spot Treyder)",
    priceStars: 250,
    priceUsdApprox: 5,
    billingCycleUz: "Oyiga",
    featuresUz: [
      "5 ta agent elagidan o'tgan barcha MEXC Spot signallari",
      "Aniq Entry, Take-Profit, Stop-Loss va R:R >= 1:2",
      "TP/SL urilganda avtomatik Telegram bildirishnoma",
      "Shaxsiy risk-profil sozlamasi"
    ]
  },
  {
    tier: "VIP",
    titleUz: "VIP (To'liq Ekotizim)",
    priceStars: 750,
    priceUsdApprox: 15,
    billingCycleUz: "Oyiga",
    featuresUz: [
      "Pro tarifdagi barcha imkoniyatlar",
      "Ustuvor tezkor signal yetkazib berish (0 kechikish)",
      "Istalgan vaqtda bir tugma bilan jonli PDF hisobot",
      "Kelajakdagi Short/Hedge va ko'p birjali signallarga birinchi kirish"
    ]
  }
];

export const LEGAL_DISCLAIMER_UZ =
  "⚠️ Huquqiy ogohlantirish: CryptoQuant-Copilot avtomatlashtirilgan texnik va bozor tahlili vositasidir. Barcha signallar va demo portfel natijalari faqat axborot maqsadida taqdim etiladi va moliyaviy maslahat hisoblanmaydi. Kriptovalyuta savdosi yuqori risk bilan bog'liq — barcha qarorlar va risklarni o'zingiz boshqarasiz.";

const DATA_DIR = path.join(process.cwd(), "data");
const SUBS_FILE = path.join(DATA_DIR, "subscriptions.json");

let subscribers = loadSubscribers();

function loadSubscribers(): Record<string, SubscriberRecord> {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBS_FILE, "utf-8")) as Record<string, SubscriberRecord>;
    }
  } catch {
    // Fallback empty
  }
  return {};
}

function saveSubscribers(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscribers, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

export function upsertSubscriber(
  telegramUserId: string,
  username: string | null = null,
  firstName: string | null = null
): SubscriberRecord {
  const now = new Date().toISOString();
  const existing = subscribers[telegramUserId];
  if (existing) {
    existing.username = username ?? existing.username;
    existing.firstName = firstName ?? existing.firstName;
    existing.updatedAt = now;
    saveSubscribers();
    return existing;
  }

  const created: SubscriberRecord = {
    telegramUserId,
    username,
    firstName,
    tier: "FREE",
    riskProfile: "MODERATE",
    createdAt: now,
    updatedAt: now
  };
  subscribers[telegramUserId] = created;
  saveSubscribers();
  return created;
}

export function updateSubscriberRisk(telegramUserId: string, riskProfile: RiskProfile): SubscriberRecord {
  const user = upsertSubscriber(telegramUserId);
  user.riskProfile = riskProfile;
  user.updatedAt = new Date().toISOString();
  saveSubscribers();
  return user;
}

export function getSubscriberCount(): number {
  return Object.keys(subscribers).length;
}

export function resetSubscribersForTest(): void {
  subscribers = {};
}
