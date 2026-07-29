export const PRIZE_CATEGORY_EXPECTED_WINNERS = {
  prizeFirst: 1,
  prizeFirstNear: 2,
  prizeSecond: 5,
  prizeThird: 10,
  prizeForth: 50,
  prizeFifth: 100,
  runningNumberFrontThree: 2,
  runningNumberBackThree: 2,
  runningNumberBackTwo: 1,
} as const;

export const PRIZE_CATEGORY_ORDER = [
  "prizeFirst",
  "prizeFirstNear",
  "prizeSecond",
  "prizeThird",
  "prizeForth",
  "prizeFifth",
  "runningNumberFrontThree",
  "runningNumberBackThree",
  "runningNumberBackTwo",
] as const;

export type PrizeCategory = (typeof PRIZE_CATEGORY_ORDER)[number];

export const PRIZE_LABELS: Record<PrizeCategory, string> = {
  prizeFirst: "First Prize",
  prizeFirstNear: "First Prize Runners-up",
  prizeSecond: "Second Prize",
  prizeThird: "Third Prize",
  prizeForth: "Fourth Prize",
  prizeFifth: "Fifth Prize",
  runningNumberFrontThree: "Front 3 Digits",
  runningNumberBackThree: "Back 3 Digits",
  runningNumberBackTwo: "Back 2 Digits",
};

export const PRIZE_AMOUNTS: Record<PrizeCategory, number> = {
  prizeFirst: 6000000,
  prizeFirstNear: 100000,
  prizeSecond: 200000,
  prizeThird: 80000,
  prizeForth: 40000,
  prizeFifth: 20000,
  runningNumberFrontThree: 4000,
  runningNumberBackThree: 4000,
  runningNumberBackTwo: 2000,
};

export const TOTAL_EXPECTED_ROWS = Object.values(PRIZE_CATEGORY_EXPECTED_WINNERS).reduce((sum, count) => sum + count, 0);

export interface CanonicalResultRow {
  prize_category: PrizeCategory;
  label: string;
  prize_amount: number;
  winning_number: string;
}

export function rowsFor(category: PrizeCategory, numbers: string[]): CanonicalResultRow[] {
  return numbers.map((winning_number) => ({
    prize_category: category,
    label: PRIZE_LABELS[category],
    prize_amount: PRIZE_AMOUNTS[category],
    winning_number,
  }));
}

export function getCompleteness(rows: Array<{ prize_category: string }>) {
  const countsByCategory = Object.fromEntries(PRIZE_CATEGORY_ORDER.map((category) => [category, 0])) as Record<
    PrizeCategory,
    number
  >;

  for (const row of rows) {
    if (PRIZE_CATEGORY_ORDER.includes(row.prize_category as PrizeCategory)) {
      countsByCategory[row.prize_category as PrizeCategory] += 1;
    }
  }

  const missingCategories = PRIZE_CATEGORY_ORDER.filter(
    (category) => countsByCategory[category] < PRIZE_CATEGORY_EXPECTED_WINNERS[category],
  );

  return {
    isComplete: missingCategories.length === 0,
    hasFirstPrize: countsByCategory.prizeFirst >= 1,
    countsByCategory,
    missingCategories,
  };
}

export function canonicalSignature(rows: CanonicalResultRow[]): string {
  return [...rows]
    .sort((a, b) => {
      const categoryDiff = PRIZE_CATEGORY_ORDER.indexOf(a.prize_category) - PRIZE_CATEGORY_ORDER.indexOf(b.prize_category);
      if (categoryDiff !== 0) return categoryDiff;
      return a.winning_number.localeCompare(b.winning_number);
    })
    .map((row) => `${row.prize_category}:${row.winning_number}:${row.prize_amount}`)
    .join("|");
}

export function validateRows(rows: CanonicalResultRow[]): { isComplete: boolean; message: string } {
  const unique = new Set(rows.map((row) => `${row.prize_category}:${row.winning_number}`));
  if (unique.size !== rows.length) return { isComplete: false, message: "Duplicate prize rows" };

  const completeness = getCompleteness(rows);
  if (!completeness.isComplete) return { isComplete: false, message: `Incomplete rows: missing ${completeness.missingCategories.join(", ")}` };

  for (const category of PRIZE_CATEGORY_ORDER) {
    const expected = PRIZE_CATEGORY_EXPECTED_WINNERS[category];
    const actual = completeness.countsByCategory[category];
    if (actual !== expected) return { isComplete: false, message: `Unexpected ${category} count ${actual}/${expected}` };
  }

  for (const row of rows) {
    const digits = row.prize_category === "runningNumberBackTwo"
      ? 2
      : row.prize_category === "runningNumberFrontThree" || row.prize_category === "runningNumberBackThree"
        ? 3
        : 6;
    if (!new RegExp(`^\\d{${digits}}$`).test(row.winning_number)) {
      return { isComplete: false, message: `Invalid number for ${row.prize_category}` };
    }
  }

  return { isComplete: true, message: "Complete" };
}
