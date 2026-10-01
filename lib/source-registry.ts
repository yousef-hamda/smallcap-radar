export type SourceAccess = 'free-no-key' | 'free-with-key' | 'free-quota-limited' | 'paid-or-licensed' | 'unverified-terms';
export type AcquisitionState = 'implemented' | 'partial' | 'planned' | 'not-guaranteed';

export type DataSource = {
  name: string;
  url: string;
  access: SourceAccess;
  primary: boolean;
  note: string;
};

export type DataFieldFamily = {
  id: string;
  label: string;
  fields: string[];
  state: AcquisitionState;
  refresh: 'market-session' | 'filing-event' | 'on-demand' | 'periodic' | 'manual';
  sources: DataSource[];
  hardLimit: string;
};

/**
 * Auditable source map for the supplied company-analysis prompt. “Free” means
 * an endpoint can be accessed without paying; it does not imply public display
 * or redistribution rights. Source permissions and limits are displayed so a
 * public-facing feed is never inferred to be licensed by mere reachability.
 */
export const DATA_FIELD_REGISTRY: readonly DataFieldFamily[] = [
  {
    id: 'identity-security', label: 'هوية الشركة ونوع الورقة', fields: ['symbol', 'CIK', 'exchange', 'share class', 'security type', 'former names'], state: 'partial', refresh: 'periodic',
    sources: [
      { name: 'SEC ticker directory and submissions', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Official issuer/CIK and filing identity; this source does not by itself prove the currently listed share class or security type.' },
      { name: 'Nasdaq Trader symbol directories', url: 'https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs', access: 'free-no-key', primary: true, note: 'Exchange-maintained listing and issue-name fields. The adapter classifies common/preferred/warrant/unit/right/fund/debt/ADR only when explicitly named; issuer-name heuristics are prohibited. ADR per-share valuation still needs a verified ratio. Reuse/display terms still require review.' },
    ], hardLimit: 'Issue descriptions without an explicit class and complex corporate-action mappings remain unresolved. ADR listings remain research-only until the ADR-to-underlying-share ratio is verified. The directory is an identity candidate, not proof of comprehensive listing history.',
  },
  {
    id: 'quote-price-history', label: 'السعر والتاريخ اليومي', fields: ['current price', 'last completed close', 'daily return', 'daily/weekly/monthly bars', 'corporate actions'], state: 'partial', refresh: 'market-session',
    sources: [
      { name: 'Cboe delayed historical chart endpoint', url: 'https://www.cboe.com/us/equities/market_statistics/historical_market_data/', access: 'unverified-terms', primary: true, note: 'No-key delayed history adapter exists; commercial display/redistribution entitlement is not established.' },
      { name: 'Yahoo Finance chart endpoints', url: 'https://query1.finance.yahoo.com/', access: 'unverified-terms', primary: false, note: 'No-key implementation is used as a best-effort source; it is not an exchange-guaranteed licensed feed.' },
      { name: 'Nasdaq Data Link market data', url: 'https://data.nasdaq.com/terms', access: 'paid-or-licensed', primary: false, note: 'Published terms make use internal unless the applicable order form grants broader rights; no public product redistribution right is established by API availability.' },
    ], hardLimit: 'No public source in this registry guarantees free, real-time, rights-cleared consolidated US equity data for all symbols.',
  },
  {
    id: 'filings-fundamentals', label: 'القوائم المالية والإفصاحات', fields: ['revenue', 'gross profit', 'operating income', 'net income', 'EPS', 'cash flow', 'capex', 'working capital', 'balance sheet', 'debt', 'shares', 'SBC'], state: 'partial', refresh: 'filing-event',
    sources: [
      { name: 'SEC Company Facts, Submissions, Frames and nightly bulk archives', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Standard US-GAAP/IFRS facts and filing metadata; custom concepts and comparability are not guaranteed. SEC states government-created and EDGAR public filing content is free to access and reuse; attribute SEC, do not use SEC seal/marks, and follow fair-access controls.' },
      { name: 'Issuer IR filings, earnings releases and presentations', url: 'https://www.sec.gov/edgar/search/', access: 'free-no-key', primary: true, note: 'Issuer-specific material and non-GAAP reconciliation; content is unstructured and requires source-specific extraction.' },
      { name: 'Financial Modeling Prep Basic', url: 'https://site.financialmodelingprep.com/developer/docs/pricing', access: 'free-quota-limited', primary: false, note: '250 calls/day; published terms require a specific display/licensing agreement for redistribution.' },
      { name: 'Financial Datasets API and hosted MCP', url: 'https://www.financial-datasets.ai/pricing', access: 'paid-or-licensed', primary: false, note: 'MCP calls count as billable API requests. Current self-serve pricing starts at $20 per 1,000 credits or $200/month; serving underlying data to product users requires the Scale redistribution tier ($2,000/month) or a separate written agreement. Not eligible for the all-free scanner.' },
    ], hardLimit: 'Financial reporting can use nonstandard fiscal periods, custom tags, amended filings and foreign taxonomies. Never combine incompatible periods or currencies.',
  },
  {
    id: 'foreign-currency-conversion', label: 'تحويل العملات للقوائم المالية', fields: ['daily ECB reference rates', 'income-statement period-average USD conversion', 'balance-sheet period-end USD conversion', 'reported currency and conversion provenance'], state: 'partial', refresh: 'on-demand',
    sources: [
      { name: 'ECB Data Portal EXR reference rates and SDMX API', url: 'https://data.ecb.europa.eu/help/api/data', access: 'free-no-key', primary: true, note: 'The public SDMX API has daily/monthly series and date-range filters. ESCB statistics are free to reuse with source attribution and without modifying the published observations; any derived currency translation must be clearly labeled and preserve rate dates. ECB bilateral series quote each currency against EUR, so conversion to USD needs identity-checked cross rates and explicit missing-rate handling.' },
      { name: 'Frankfurter API filtered to ECB provider · bounded transport fallback', url: 'https://frankfurter.dev/', access: 'free-no-key', primary: false, note: 'Used only when direct ECB API transport fails. Requests are explicitly filtered to the ECB provider, narrow base/quote/date parameters, and retain the Frankfurter endpoint as provenance; the rate series remains attributable to ECB. Public endpoint is rate-limited to prevent abuse and does not provide a commercial redistribution license for arbitrary third-party data.' },
      { name: 'SEC Foreign Issuer reporting-currency guidance', url: 'https://www.sec.gov/about/divisions-offices/division-corporation-finance/financial-reporting-manual/frm-topic-6', access: 'free-no-key', primary: true, note: 'SEC describes period-end rates for balance sheets and weighted-average rates for comprehensive-income statements; convenience translation is distinct from issuer-reporting currency and should be disclosed. This guidance does not certify any converted model input as audited.' },
    ], hardLimit: 'Detailed profiles translate income-statement flows at period-average daily cross-rates and balance-sheet stocks at the previous period-end cross-rate only when rate coverage/endpoints pass; each value records SEC and ECB lineage and is labeled a non-audited convenience translation. The translation is not used in scoring or bulk scans. Non-USD financial strength remains unscored pending issuer functional-currency/translation-convention review; hyperinflation, changed functional currencies, currencies absent from ECB, source-to-filing reconciliation and product-wide validation remain blockers.',
  },
  {
    id: 'financial-strength-solvency', label: 'القوة المالية واستحقاقات الدين', fields: ['cash and cash equivalents', 'current/noncurrent borrowings', 'TTM operating cash flow and capex', 'interest coverage', 'rolling 24-month principal maturities', 'cash runway'], state: 'partial', refresh: 'filing-event',
    sources: [
      { name: 'SEC Company Facts standard US-GAAP/IFRS concepts', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'An issuer-identity-checked adapter derives sourced cash, debt, four-quarter cash flow/interest, and rolling year-two maturities. Requires all inputs, same reporting currency/date, recent filings, and a supported industrial operating-company model.' },
      { name: 'SEC XBRL taxonomy documentation', url: 'https://xbrl.fasb.org/resources/taxonomyfaq.pdf', access: 'free-no-key', primary: true, note: 'Fiscal-year maturity schedules and rolling-year maturity schedules are distinct concepts; a missing rolling year-two value is not filled from a fiscal-year schedule.' },
    ], hardLimit: 'Partial standard-tag coverage only. Covenants, lease/factoring debt, restricted-cash adjustments, custom taxonomy and specialized financial/REIT/utility models require source-level review or a separate formula; missing data stays unscored.',
  },
  {
    id: 'valuation-multiples', label: 'التقييم والقيمة العادلة', fields: ['P/E', 'EV/EBITDA', 'EV/Sales', 'P/FCF', 'PEG', 'DCF', 'SOTP', 'peer multiples', 'fully diluted share count'], state: 'planned', refresh: 'filing-event',
    sources: [
      { name: 'SEC facts plus market-price source', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Inputs can be derived when periods, debt, cash, share count and market capitalization are comparable and sourced.' },
    ], hardLimit: 'Fair value is a model estimate. Each method needs disclosed assumptions and industry-specific applicability; analyst target averages alone do not qualify.',
  },
  {
    id: 'catalysts-contracts', label: 'العقود والعملاء والمحركات', fields: ['contracts', 'backlog', 'customers', 'partnerships', 'orders', 'MOU/LOI', 'capacity', 'approvals', 'earnings calendar', 'guidance'], state: 'partial', refresh: 'filing-event',
    sources: [
      { name: 'SEC 8-K/10-Q/10-K/6-K/20-F/40-F and exhibits', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Deep profiles expose up to 60 recent filing links and scan up to four recent domestic 8-K bodies for referenced item numbers within a 7-second/1.5MB bound. This is discovery metadata only; filing content, exhibits, contract value, binding status, revenue conversion and catalyst materiality are not classified or reviewed. Scan snapshots omit the profile data to limit storage.' },
      { name: 'Issuer investor-relations releases and earnings materials', url: 'https://www.sec.gov/edgar/search/', access: 'free-no-key', primary: true, note: 'Official but issuer-specific web content; a partnership announcement is not automatically a paying customer or recognized revenue.' },
      { name: 'ClinicalTrials.gov API v2', url: 'https://clinicaltrials.gov/data-api/about-api', access: 'free-no-key', primary: true, note: 'Primary clinical-trial registrations and status; sponsor-to-public-issuer matching is not guaranteed, and a registered trial is not proof of efficacy.' },
      { name: 'openFDA APIs', url: 'https://open.fda.gov/apis/', access: 'free-no-key', primary: true, note: 'Applicable regulatory/drug/device disclosures only; coverage varies by dataset and does not replace SEC or issuer evidence.' },
    ], hardLimit: 'Unreported customer identity, contract value, probability, market pricing-in, and conditional grants cannot be reliably inferred.',
  },
  {
    id: 'insider-ownership', label: 'المطلعون والملكية', fields: ['Form 4 code P', 'Form 144', '13D/13G', 'officer ownership', '10b5-1', 'buybacks', 'institutional 13F'], state: 'partial', refresh: 'filing-event',
    sources: [
      { name: 'SEC EDGAR filings and XBRL/filing exhibits', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Primary filed data; code P must be separated from grants, exercises, tax withholding, gifts and planned sales.' },
    ], hardLimit: '13F is delayed and does not establish current beneficial ownership; Form 144 is notice, not proof of completed sale.',
  },
  {
    id: 'governance-litigation', label: 'الحوكمة والدعاوى والمحاسبة', fields: ['auditor', 'internal controls', 'related parties', 'board independence', 'executive pay', 'lawsuits', 'investigations', 'restatements', 'going concern'], state: 'planned', refresh: 'filing-event',
    sources: [
      { name: 'SEC filings and issuer proxy statements', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Primary issuer disclosures; absence of a filing is not proof of no litigation or governance risk.' },
      { name: 'Public court dockets and regulator releases', url: 'https://www.courtlistener.com/', access: 'unverified-terms', primary: false, note: 'Coverage, identity matching and reuse rights must be reviewed before scoring.' },
    ], hardLimit: 'A free source cannot establish an exhaustive litigation search across every state/federal court and private investigation.',
  },
  {
    id: 'peers-sector', label: 'المنافسون والقطاع', fields: ['industry', '3–5 comparable peers', 'market size', 'market share', 'switching cost', 'substitution', 'supply chain'], state: 'planned', refresh: 'periodic',
    sources: [
      { name: 'SEC filings and official industry/regulatory sources', url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', access: 'free-no-key', primary: true, note: 'Primary company and regulator disclosures; market-size and share estimates need their own source and method.' },
    ], hardLimit: 'There is no uniform SEC taxonomy or free authoritative comparable-company/market-share feed for all issuers.',
  },
  {
    id: 'analyst-estimates', label: 'توقعات المحللين ومفاجآت الأرباح', fields: ['analyst count', 'consensus estimates', 'earnings surprise', 'target range'], state: 'not-guaranteed', refresh: 'periodic',
    sources: [
      { name: 'Nasdaq quote summary (one-year target field)', url: 'https://www.nasdaq.com/market-activity/stocks', access: 'unverified-terms', primary: false, note: 'A single field is not a validated consensus distribution or point-in-time analyst dataset.' },
      { name: 'Alpha Vantage', url: 'https://www.alphavantage.co/support/', access: 'free-quota-limited', primary: false, note: '25 requests/day general free limit; real-time and 15-minute delayed US market data are premium.' },
    ], hardLimit: 'No free quota here supports full-universe estimates history; analyst targets never stand alone as fair value.',
  },
  {
    id: 'short-interest-borrow', label: 'البيع على المكشوف والاقتراض', fields: ['official short interest', 'float percentage', 'days to cover', 'borrow fee', 'shares available'], state: 'not-guaranteed', refresh: 'periodic',
    sources: [
      { name: 'FINRA Equity Short Interest public dataset and API', url: 'https://www.finra.org/finra-data/browse-catalog/equity-short-interest', access: 'free-with-key', primary: true, note: 'The API requires a registered Public credential; the five-year public dataset covers exchange-listed and OTC equities on a twice-monthly settlement/reporting schedule. FINRA says individual access is not intended for commercial use at this time, so production display rights need confirmation. This is position data, not daily short-sale volume; borrow fee and availability are separate.' },
      { name: 'Nasdaq Trader / Nasdaq.com public issue lookup', url: 'https://www.nasdaqtrader.com/trader.aspx?id=ShortInterest', access: 'unverified-terms', primary: true, note: 'Nasdaq exposes a public per-issue lookup and rolling 12-month history for covered listings, updated twice monthly. Full bulk file access is subscription-based; public page visibility does not establish automated extraction or product redistribution rights. Scope does not cover all US listing venues.' },
      { name: 'NYSE Group Short Interest File', url: 'https://www.nyse.com/data-products/catalog/nyse-group-short-interest', access: 'paid-or-licensed', primary: true, note: 'Official semi-monthly positions for NYSE, NYSE Arca, and NYSE American listings; the product catalog does not establish a free bulk API or product redistribution grant.' },
    ], hardLimit: 'Daily short-sale volume is not short interest; free, point-in-time borrow fee/availability is not guaranteed.',
  },
  {
    id: 'technical-indicators', label: 'المؤشرات الفنية والتوقيت', fields: ['daily/weekly/monthly trend', '20/50/100/200 MA', 'RSI', 'MACD', 'volume', 'gaps', 'support/resistance', 'relative strength'], state: 'partial', refresh: 'market-session',
    sources: [
      { name: 'Dated OHLCV history and corporate actions', url: 'https://query1.finance.yahoo.com/', access: 'unverified-terms', primary: false, note: 'Indicators should be derived locally from validated daily bars, with exact observation dates and split handling.' },
      { name: 'Nasdaq Data Link historical bars', url: 'https://www.nasdaq.com/products/data/data-link/api', access: 'paid-or-licensed', primary: false, note: 'Exchange-wide official history is an entitlement product.' },
    ], hardLimit: 'On-demand profile acquisition derives completed daily/weekly/monthly bars, moving averages, RSI and benchmark-relative strength. The current Yahoo/Cboe/Nasdaq sources are not licensed for redistribution in this app, so the derived factor remains unscored until rights are verified. MACD, gap, volume-profile and support/resistance reviews are not implemented; support/resistance and accumulation/distribution also require analyst interpretation.',
  },
  {
    id: 'macro', label: 'السياق الاقتصادي', fields: ['rates', 'credit conditions', 'inflation', 'FX', 'sector benchmarks'], state: 'planned', refresh: 'periodic',
    sources: [
      { name: 'FRED/ALFRED', url: 'https://fred.stlouisfed.org/docs/api/fred/', access: 'free-with-key', primary: true, note: 'Registered API key required; individual series can carry third-party restrictions and vintage matters.' },
    ], hardLimit: 'Macro context is not evidence that a company will succeed; use as a separately dated context input.',
  },
] as const satisfies readonly DataFieldFamily[];

export function sourceRegistrySummary() {
  return {
    version: '1.1.0',
    updatedAt: '2026-10-01',
    fieldFamilies: DATA_FIELD_REGISTRY.length,
    implemented: DATA_FIELD_REGISTRY.filter(field => field.state === 'implemented').length,
    partial: DATA_FIELD_REGISTRY.filter(field => field.state === 'partial').length,
    planned: DATA_FIELD_REGISTRY.filter(field => field.state === 'planned').length,
    notGuaranteed: DATA_FIELD_REGISTRY.filter(field => field.state === 'not-guaranteed').length,
    fields: DATA_FIELD_REGISTRY,
  };
}
