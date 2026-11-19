export interface NewsShieldStatus {
  active: boolean;
  eventTitle: string | null;
  reason: string | null;
  checkedAt: string;
}

let manualOverride: NewsShieldStatus | null = null;

export function getActiveNewsShield(): NewsShieldStatus {
  if (manualOverride) {
    return manualOverride;
  }
  const envActive = String(process.env.MACRO_NEWS_SHIELD_ACTIVE || "").toLowerCase() === "true";
  if (envActive) {
    const title = process.env.MACRO_NEWS_EVENT_TITLE || "High-Impact USD Macro News";
    return {
      active: true,
      eventTitle: title,
      reason: `USD Macro News Shield faol (${title})`,
      checkedAt: new Date().toISOString()
    };
  }
  return {
    active: false,
    eventTitle: null,
    reason: null,
    checkedAt: new Date().toISOString()
  };
}

export function setNewsShieldOverrideForTest(status: NewsShieldStatus | null): void {
  manualOverride = status;
}
