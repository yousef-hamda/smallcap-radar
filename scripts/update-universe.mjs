import fs from 'node:fs/promises';

const [secPath, nasdaqPath, outputPath] = process.argv.slice(2);
if (!secPath || !nasdaqPath || !outputPath) {
  throw new Error('Usage: node scripts/update-universe.mjs SEC_JSON NASDAQ_JSON OUTPUT_JSON');
}

const sec = JSON.parse(await fs.readFile(secPath, 'utf8'));
const screener = JSON.parse(await fs.readFile(nasdaqPath, 'utf8'));
const fields = sec.fields;
const quotes = new Map((screener.data?.rows ?? []).map((row) => [row.symbol, row]));
const companies = sec.data
  .map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])))
  .filter((company) => ['Nasdaq', 'NYSE', 'NYSE American'].includes(company.exchange))
  .filter((company) => /^[A-Z0-9.-]{1,12}$/.test(company.ticker))
  .map((company) => {
    const quote = quotes.get(company.ticker);
    const price = Number(String(quote?.lastsale ?? '').replace(/[$,]/g, ''));
    const marketCap = Number(quote?.marketCap);
    const volume = Number(quote?.volume);
    return {
      ...company,
      ...(Number.isFinite(price) && price > 0 ? { price } : {}),
      ...(Number.isFinite(marketCap) && marketCap > 0 ? { marketCap } : {}),
      ...(Number.isFinite(volume) && volume >= 0 ? { volume } : {}),
      ...(quote?.sector ? { sector: quote.sector } : {}),
      ...(quote?.industry ? { industry: quote.industry } : {}),
    };
  });

await fs.writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: [
    'https://www.sec.gov/files/company_tickers_exchange.json',
    'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&download=true',
  ],
  companies,
})}\n`);

console.log(`Wrote ${companies.length} companies to ${outputPath}`);
