export interface DailyQuote {
  text: string;
  author: string;
}

export async function quoteForDate(date: string): Promise<DailyQuote> {
  const { default: quotations } = await import('./dailyQuotes.json');
  const quotes = quotations as DailyQuote[];
  const [year, month, day] = date.split('-').map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const index = ((dayNumber % quotes.length) + quotes.length) % quotes.length;
  return quotes[index];
}
