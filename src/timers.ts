import type { UpgradeTimer } from "./types";

export const TIMER_MAX = 12;
export const TIMER_MAX_DAYS = 30;
const TIMER_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export function validateTimerInput(input: unknown, now = Date.now()): { kind: UpgradeTimer["kind"]; label: string; endsAt: string } {
  if (!input || typeof input !== "object") throw new Error("Timer must be an object");
  const body = input as Record<string, unknown>;
  const kinds = ["builder", "lab", "pet", "hero", "other"];
  if (typeof body.kind !== "string" || !kinds.includes(body.kind)) throw new Error("Timer kind is invalid");
  if (typeof body.label !== "string" || !body.label.trim() || body.label.trim().length > 60) throw new Error("Timer label must be 1–60 characters");
  let endsAt = typeof body.endsAt === "string" ? Date.parse(body.endsAt) : NaN;
  if (!Number.isFinite(endsAt) && typeof body.durationSeconds === "number") endsAt = now + body.durationSeconds * 1000;
  if (!Number.isFinite(endsAt) || endsAt <= now) throw new Error("Timer end must be in the future");
  if (endsAt > now + TIMER_MAX_DAYS * 24 * 60 * 60 * 1000) throw new Error("Timer cannot be more than 30 days ahead");
  return { kind: body.kind as UpgradeTimer["kind"], label: body.label.trim(), endsAt: new Date(endsAt).toISOString() };
}

export function activeTimers(timers: UpgradeTimer[], now = Date.now()) {
  return timers.filter((timer) => Date.parse(timer.endsAt) > now || (!timer.notified && Date.parse(timer.endsAt) + TIMER_RETENTION_MS > now));
}

export function expireTimers(timers: UpgradeTimer[], now = Date.now()) {
  return timers.filter((timer) => Date.parse(timer.endsAt) + TIMER_RETENTION_MS > now);
}

export function timerIsComplete(timer: UpgradeTimer, now = Date.now()) {
  return !timer.notified && Date.parse(timer.endsAt) <= now;
}

export function timerId() {
  return crypto.randomUUID();
}

export async function processTimers(
  tag: string,
  state: { get<T>(key: string, type: "json"): Promise<T | null>; put(key: string, value: string): Promise<void> },
  now = Date.now(),
) {
  const normalized = tag.replace(/^#/, "");
  const key = `timers:${normalized}`;
  const stored = (await state.get<UpgradeTimer[]>(key, "json")) ?? [];
  const retained = expireTimers(stored, now);
  const completed = retained.filter((timer) => timerIsComplete(timer, now));
  if (completed.length) {
    const feedKey = `feed:${normalized}`;
    const feed = (await state.get<Array<{ id: string; type: string; createdAt: string; message: string; data?: Record<string, string | number> }>>(feedKey, "json")) ?? [];
    const events = completed.map((timer) => ({
      id: `timer:${timer.id}`,
      type: "timer_completed",
      createdAt: new Date(now).toISOString(),
      message: `${timer.kind === "builder" ? "Builder" : timer.kind === "lab" ? "Laboratory" : timer.kind === "pet" ? "Pet" : timer.kind === "hero" ? "Hero" : "Upgrade"} finished: ${timer.label}.`,
      data: { timerId: timer.id, label: timer.label },
    }));
    await state.put(feedKey, JSON.stringify([...events, ...feed].slice(0, 100)));
  }
  const updated = retained.map((timer) => completed.some((item) => item.id === timer.id) ? { ...timer, notified: true } : timer);
  await state.put(key, JSON.stringify(updated));
  return updated;
}
