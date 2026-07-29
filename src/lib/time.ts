export const BANGKOK_TIMEZONE = "Asia/Bangkok";

export function getBangkokParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BANGKOK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hhmmss: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
    hour,
    minute,
    second,
    secondsSinceMidnight: hour * 3600 + minute * 60 + second,
  };
}

export function isWithinWindow(hhmm: string, start: string, end: string): boolean {
  return hhmm >= start && hhmm <= end;
}

export function minuteMark(drawDate: string, time: string): string {
  const hhmmss = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return `${drawDate}T${hhmmss}+07:00`;
}

export function pollSlotKey(drawDate: string, secondsSinceMidnight: number, frequencySeconds: number): string {
  const frequency = Math.max(15, frequencySeconds);
  return `${drawDate}-${Math.floor(secondsSinceMidnight / frequency)}`;
}
