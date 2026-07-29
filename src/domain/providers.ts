import { sha256Hex } from "../lib/crypto.js";
import {
  CanonicalResultRow,
  canonicalSignature,
  rowsFor,
  validateRows,
} from "./prizes.js";

export type ProviderName = "kapook" | "myhora" | "sanook";

export interface ProviderParseResult {
  provider: ProviderName;
  sourceUrl: string;
  httpStatus: number | null;
  sourceDate: string | null;
  rows: CanonicalResultRow[];
  isComplete: boolean;
  message: string;
  durationMs: number;
  rawHash: string | null;
  resultSignature: string | null;
}

const thaiMonths: Record<string, number> = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function drawDateParts(drawDate: string) {
  const [year, month, day] = drawDate.split("-").map(Number);
  return { year, month, day, thaiYear: year + 543 };
}

function toThaiLottoId(drawDate: string): string {
  const { day, month, thaiYear } = drawDateParts(drawDate);
  return `${pad2(day)}${pad2(month)}${thaiYear}`;
}

function toThaiShortId(drawDate: string): string {
  const { day, month, thaiYear } = drawDateParts(drawDate);
  return `${pad2(day)}${pad2(month)}${String(thaiYear).slice(-2)}`;
}

function toMyHoraPath(drawDate: string): string {
  const { day, month, thaiYear } = drawDateParts(drawDate);
  return `result-${pad2(day)}-${pad2(month)}-${thaiYear}.aspx`;
}

export function providerUrl(provider: ProviderName, drawDate: string): string {
  switch (provider) {
    case "kapook":
      return `https://lottery.kapook.com/check/${toThaiShortId(drawDate)}`;
    case "myhora":
      return `https://myhora.com/lottery/${toMyHoraPath(drawDate)}`;
    case "sanook":
      return `https://news.sanook.com/lotto/check/${toThaiLottoId(drawDate)}/`;
  }
}

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(input: string): string {
  return decodeHtml(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function bodyOnly(html: string): string {
  const bodyIndex = html.search(/<body[\s>]/i);
  return bodyIndex >= 0 ? html.slice(bodyIndex) : html;
}

export function parseThaiDrawDate(html: string): string | null {
  const text = stripTags(html);
  const monthPattern = Object.keys(thaiMonths).join("|");
  const match = text.match(new RegExp(`(?:วันที่|ประจำวันที่|งวด)\\s*(\\d{1,2})\\s*(${monthPattern})\\s*(\\d{4})`));
  if (!match) return null;

  const day = Number(match[1]);
  const month = thaiMonths[match[2]];
  const rawYear = Number(match[3]);
  const year = rawYear > 2400 ? rawYear - 543 : rawYear;
  if (!day || !month || !year) return null;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function sectionBetween(html: string, start: string, end: string | string[]): string {
  const startIndex = html.indexOf(start);
  if (startIndex < 0) return "";

  const endMarkers = Array.isArray(end) ? end : [end];
  let endIndex = html.length;
  for (const marker of endMarkers) {
    const candidate = html.indexOf(marker, startIndex + start.length);
    if (candidate >= 0 && candidate < endIndex) endIndex = candidate;
  }
  return html.slice(startIndex, endIndex);
}

function numbersFromSection(section: string, digits: number): string[] {
  const text = stripTags(section);
  const pattern = new RegExp(`(?<!\\d)\\d{${digits}}(?!\\d)`, "g");
  const values = text.match(pattern) || [];
  return values.filter((value) => !/^x+$/i.test(value) && !/^0+$/.test(value));
}

function genericThaiPageRows(html: string): CanonicalResultRow[] {
  const body = bodyOnly(html);
  const first = numbersFromSection(sectionBetween(body, "รางวัลที่ 1", "เลขหน้า 3 ตัว"), 6).slice(0, 1);
  const front3 = numbersFromSection(sectionBetween(body, "เลขหน้า 3 ตัว", "เลขท้าย 3 ตัว"), 3).slice(0, 2);
  const back3 = numbersFromSection(sectionBetween(body, "เลขท้าย 3 ตัว", "เลขท้าย 2 ตัว"), 3).slice(0, 2);
  const back2 = numbersFromSection(sectionBetween(body, "เลขท้าย 2 ตัว", ["รางวัลข้างเคียง", "ข้างเคียง"]), 2).slice(0, 1);
  const near = numbersFromSection(sectionBetween(body, "รางวัลข้างเคียง", "รางวัลที่ 2"), 6).slice(0, 2);
  const second = numbersFromSection(sectionBetween(body, "รางวัลที่ 2", "รางวัลที่ 3"), 6).slice(0, 5);
  const third = numbersFromSection(sectionBetween(body, "รางวัลที่ 3", "รางวัลที่ 4"), 6).slice(0, 10);
  const forth = numbersFromSection(sectionBetween(body, "รางวัลที่ 4", "รางวัลที่ 5"), 6).slice(0, 50);
  const fifth = numbersFromSection(sectionBetween(body, "รางวัลที่ 5", ["ตรวจหวย", "</main>", "</body>"]), 6).slice(0, 100);

  return [
    ...rowsFor("prizeFirst", first),
    ...rowsFor("prizeFirstNear", near),
    ...rowsFor("prizeSecond", second),
    ...rowsFor("prizeThird", third),
    ...rowsFor("prizeForth", forth),
    ...rowsFor("prizeFifth", fifth),
    ...rowsFor("runningNumberFrontThree", front3),
    ...rowsFor("runningNumberBackThree", back3),
    ...rowsFor("runningNumberBackTwo", back2),
  ];
}

function myHoraRows(html: string): CanonicalResultRow[] {
  const body = bodyOnly(html);
  const topClassIndex = body.indexOf("lotto-fxl");
  const topStart = topClassIndex >= 0 ? Math.max(0, body.lastIndexOf("<div", topClassIndex)) : -1;
  const topEnd = body.indexOf("id=\"p_result2\"");
  const top = topStart >= 0 && topEnd > topStart ? body.slice(topStart, topEnd) : "";
  const groups = [...top.matchAll(/<div[^>]*lotto-fxl[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => stripTags(m[1]));

  const first = numbersFromSection(groups[0] || "", 6).slice(0, 1);
  const front3 = numbersFromSection(groups[1] || "", 3).slice(0, 2);
  const back3 = numbersFromSection(groups[2] || "", 3).slice(0, 2);
  const back2 = numbersFromSection(groups[3] || "", 2).slice(0, 1);
  const lower = topEnd >= 0 ? body.slice(topEnd) : body;

  const near = numbersFromSection(sectionBetween(lower, "รางวัลข้างเคียง", "รางวัลที่ 2"), 6).slice(0, 2);
  const second = numbersFromSection(sectionBetween(lower, "รางวัลที่ 2", "รางวัลที่ 3"), 6).slice(0, 5);
  const third = numbersFromSection(sectionBetween(lower, "รางวัลที่ 3", "รางวัลที่ 4"), 6).slice(0, 10);
  const forth = numbersFromSection(sectionBetween(lower, "รางวัลที่ 4", "รางวัลที่ 5"), 6).slice(0, 50);
  const fifth = numbersFromSection(sectionBetween(lower, "รางวัลที่ 5", ["เลขท้าย", "</form>", "</body>"]), 6).slice(0, 100);

  return [
    ...rowsFor("prizeFirst", first),
    ...rowsFor("prizeFirstNear", near),
    ...rowsFor("prizeSecond", second),
    ...rowsFor("prizeThird", third),
    ...rowsFor("prizeForth", forth),
    ...rowsFor("prizeFifth", fifth),
    ...rowsFor("runningNumberFrontThree", front3),
    ...rowsFor("runningNumberBackThree", back3),
    ...rowsFor("runningNumberBackTwo", back2),
  ];
}

export function parseProviderHtml(provider: ProviderName, drawDate: string, html: string, sourceUrl: string, httpStatus: number): ProviderParseResult {
  const sourceDate = parseThaiDrawDate(html);
  const rows = provider === "myhora" ? myHoraRows(html) : genericThaiPageRows(html);
  const validation = validateRows(rows);
  const dateOk = sourceDate === drawDate;
  const isComplete = dateOk && validation.isComplete;
  const resultSignature = rows.length > 0 ? canonicalSignature(rows) : null;

  return {
    provider,
    sourceUrl,
    httpStatus,
    sourceDate,
    rows,
    isComplete,
    message: !dateOk ? `Source date mismatch: ${sourceDate || "unknown"}` : validation.message,
    durationMs: 0,
    rawHash: null,
    resultSignature,
  };
}

export async function fetchProvider(provider: ProviderName, drawDate: string): Promise<ProviderParseResult> {
  const sourceUrl = providerUrl(provider, drawDate);
  const start = Date.now();

  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "standalone-lottery-result-provider/1.0" },
    });
    const html = await response.text();
    const parsed = parseProviderHtml(provider, drawDate, html, sourceUrl, response.status);
    return {
      ...parsed,
      durationMs: Date.now() - start,
      rawHash: await sha256Hex(html),
      isComplete: response.ok && parsed.isComplete,
      message: response.ok ? parsed.message : `${provider.toUpperCase()}_HTTP_${response.status}`,
    };
  } catch (error) {
    return {
      provider,
      sourceUrl,
      httpStatus: null,
      sourceDate: null,
      rows: [],
      isComplete: false,
      message: error instanceof Error ? error.message : "Unknown provider error",
      durationMs: Date.now() - start,
      rawHash: null,
      resultSignature: null,
    };
  }
}
