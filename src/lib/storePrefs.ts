/** Client-side prefs for Andy sketch features not yet in MQTT/DB contract.
 *  Autosaved to localStorage. Does not change edge firmware behavior. */

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export const WEEKDAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type LightChannel = "lot" | "sign" | "soffit";

export interface LightDayTimers {
  on1: string;
  off1: string;
  on2: string;
  off2: string;
}

export interface LightsPrefs {
  photocellOverride: boolean;
  followTheSun: boolean;
  timers: Record<Weekday, LightDayTimers>;
}

export interface HvacDaySchedule {
  on: string;
  off: string;
}

export interface HvacUnitPrefs {
  label: string;
  setpointF: number;
  schedule: Record<Weekday, HvacDaySchedule>;
}

export interface HvacPrefs {
  units: HvacUnitPrefs[];
}

function defaultDayTimers(): LightDayTimers {
  return { on1: "06:00", off1: "08:00", on2: "17:30", off2: "23:00" };
}

export function defaultLightsPrefs(): LightsPrefs {
  const timers = {} as Record<Weekday, LightDayTimers>;
  for (const d of WEEKDAYS) timers[d] = defaultDayTimers();
  return { photocellOverride: true, followTheSun: false, timers };
}

export function defaultHvacPrefs(): HvacPrefs {
  const units: HvacUnitPrefs[] = [];
  for (let i = 1; i <= 5; i++) {
    const schedule = {} as Record<Weekday, HvacDaySchedule>;
    for (const d of WEEKDAYS) schedule[d] = { on: "06:00", off: "22:00" };
    units.push({ label: `RTU-${i}`, setpointF: 70, schedule });
  }
  return { units };
}

function storageKey(restaurantId: number, kind: string) {
  return `bkems.store.${restaurantId}.${kind}`;
}

export function loadLightsPrefs(restaurantId: number): LightsPrefs {
  try {
    const raw = localStorage.getItem(storageKey(restaurantId, "lights"));
    if (!raw) return defaultLightsPrefs();
    return { ...defaultLightsPrefs(), ...JSON.parse(raw) };
  } catch {
    return defaultLightsPrefs();
  }
}

export function saveLightsPrefs(restaurantId: number, prefs: LightsPrefs) {
  localStorage.setItem(storageKey(restaurantId, "lights"), JSON.stringify(prefs));
}

export function loadHvacPrefs(restaurantId: number): HvacPrefs {
  try {
    const raw = localStorage.getItem(storageKey(restaurantId, "hvac"));
    if (!raw) return defaultHvacPrefs();
    const parsed = JSON.parse(raw) as HvacPrefs;
    const base = defaultHvacPrefs();
    return { units: parsed.units?.length === 5 ? parsed.units : base.units };
  } catch {
    return defaultHvacPrefs();
  }
}

export function saveHvacPrefs(restaurantId: number, prefs: HvacPrefs) {
  localStorage.setItem(storageKey(restaurantId, "hvac"), JSON.stringify(prefs));
}

/** Sketch light names → frozen MQTT relay keys (do not rename keys). */
export const LIGHT_RELAYS: { channel: LightChannel; label: string; relayKey: string }[] = [
  { channel: "lot", label: "Lot Lights", relayKey: "relay_parking_lot" },
  { channel: "sign", label: "Sign Lights", relayKey: "relay_exterior_signs" },
  { channel: "soffit", label: "Soffit Lights", relayKey: "relay_spare_ch4" },
];
