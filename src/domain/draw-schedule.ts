export function isOfficialDrawDate(drawDate: string): boolean {
  const parts = drawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return false;

  const month = Number(parts[2]);
  const day = Number(parts[3]);

  if ((month === 1 || month === 5) && day === 2) return true;
  if ((month === 1 || month === 5) && day === 1) return false;
  return day === 1 || day === 16;
}
