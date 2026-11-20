export interface ActivityLogEntry {
  id: string;
  ts: string;
  agent: "SCOUT" | "TECHNICIAN" | "MACRO" | "CRITIC" | "EXECUTIVE" | "TRACKER" | "ALERT" | "NEWS";
  level: "INFO" | "SUCCESS" | "WARN" | "ALERT";
  message: string;
}

const MAX_LOGS = 40;
const logs: ActivityLogEntry[] = [];

export function pushActivityLog(
  agent: ActivityLogEntry["agent"],
  level: ActivityLogEntry["level"],
  message: string
): void {
  logs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    agent,
    level,
    message
  });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

export function getRecentActivityLogs(limit = 25): ActivityLogEntry[] {
  return logs.slice(0, limit);
}
