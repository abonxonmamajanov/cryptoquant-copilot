import fs from "fs";
import path from "path";

export type PlanTier = "FREE" | "PRO" | "VIP";
export type RiskProfile = "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
export type SignalMode = "HYBRID" | "INTRADAY" | "SWING";
export type DirectionFilter = "BOTH" | "LONG" | "SHORT";

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
  signalMode?: SignalMode;
  directionFilter?: DirectionFilter;
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
      "5 ta agent elagidan o'tgan barcha MEXC Spot + 1x Hedge signallari",
      "Aniq Entry, Take-Profit, Stop-Loss va R:R >= 1:2",
      "TP/SL urilganda avtomatik Telegram bildirishnoma",
      "Shaxsiy risk-profil va yo'nalish (/direction) sozlamasi"
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
      "1x Xavfsiz SHORT/Hedge va Order-Flow signallariga to'liq kirish"
    ]
  }
];

export const LEGAL_DISCLAIMER_UZ =
  "⚠️ Huquqiy ogohlantirish: CryptoQuant-Copilot avtomatlashtirilgan texnik va bozor tahlili vositasidir. Barcha signallar (LONG hamda qat'iy 1x kredit yelkasiz SHORT/Hedge) va demo portfel natijalari faqat axborot maqsadida taqdim etiladi va moliyaviy maslahat hisoblanmaydi. Kriptovalyuta savdosi yuqori risk bilan bog'liq — barcha qarorlar va risklarni o'zingiz boshqarasiz.";

const DATA_DIR = path.join(process.cwd(), "data");
const SUBS_FILE = path.join(DATA_DIR, "subscriptions.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

let subscribers = loadSubscribers();
const loadedSettings = loadSettings();
let activeSignalMode: SignalMode = loadedSettings.signalMode;
let activeDirectionFilter: DirectionFilter = loadedSettings.directionFilter;

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

function loadSettings(): { signalMode: SignalMode; directionFilter: DirectionFilter } {
  let signalMode: SignalMode = "HYBRID";
  let directionFilter: DirectionFilter = "BOTH";
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as {
        signalMode?: SignalMode;
        directionFilter?: DirectionFilter;
      };
      if (
        parsed.signalMode === "HYBRID" ||
        parsed.signalMode === "INTRADAY" ||
        parsed.signalMode === "SWING"
      ) {
        signalMode = parsed.signalMode;
      }
      if (
        parsed.directionFilter === "BOTH" ||
        parsed.directionFilter === "LONG" ||
        parsed.directionFilter === "SHORT"
      ) {
        directionFilter = parsed.directionFilter;
      }
    }
  } catch {
    // Fallback defaults
  }
  return { signalMode, directionFilter };
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

function saveSettings(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(
        {
          signalMode: activeSignalMode,
          directionFilter: activeDirectionFilter,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // Non-fatal
  }
}

export function getActiveSignalMode(): SignalMode {
  return activeSignalMode;
}

export function setActiveSignalMode(mode: SignalMode, telegramUserId?: string): SignalMode {
  activeSignalMode = mode;
  saveSettings();
  if (telegramUserId) {
    const user = upsertSubscriber(telegramUserId);
    user.signalMode = mode;
    user.updatedAt = new Date().toISOString();
    saveSubscribers();
  }
  return activeSignalMode;
}

export function getActiveDirectionFilter(): DirectionFilter {
  return activeDirectionFilter;
}

export function setActiveDirectionFilter(
  dir: DirectionFilter,
  telegramUserId?: string
): DirectionFilter {
  activeDirectionFilter = dir;
  saveSettings();
  if (telegramUserId) {
    const user = upsertSubscriber(telegramUserId);
    user.directionFilter = dir;
    user.updatedAt = new Date().toISOString();
    saveSubscribers();
  }
  return activeDirectionFilter;
}

export function formatDirectionFilterUz(dir: DirectionFilter = activeDirectionFilter): string {
  if (dir === "LONG") return "🟢 Faqat LONG";
  if (dir === "SHORT") return "🔴 Faqat SHORT (1x)";
  return "⚖️ Ikkalasi (LONG + SHORT 1x)";
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
    signalMode: activeSignalMode,
    directionFilter: activeDirectionFilter,
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
  activeSignalMode = "HYBRID";
  activeDirectionFilter = "BOTH";
}
