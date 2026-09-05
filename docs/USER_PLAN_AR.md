نعم. قرأت الملفين كـ **specification للمشروع** وليس فقط كـ README، وهناك نقطة مهمة جدًا قبل أي بناء:

الملف الـMarkdown يصف نسخة أقدم من المحرك: بوابات `50M–5B`، سيولة `300k`، ثم Score واحد بأوزان `25/20/20/15/10/10`. أما الـPDF الأحدث فيصف تطور المشروع إلى **استراتيجيتين منفصلتين**: `Core Value` و`Bounce Mode`، ولكل واحدة هدف مختلف وقواعد مختلفة. لذلك **لن أخلط المعادلتين**. سأستخدم النظام الأحدث كـProduction Strategy، وأحتفظ بالمحرك القديم كـ**Benchmark Model** نقيس النظام الجديد مقابله. هذا يمنع تكرار المشكلة التي حصلت سابقًا عندما وُجد أكثر من منطق تقييم وأعطيا درجات مختلفة لنفس الشركة.

وهذه الخطة التي أوصي أن نبني عليها التطبيق الجديد.

# الخطة الكاملة — Small-Cap Radar V2

## 1. ما الذي نبنيه بالضبط؟

نحن لا نبني مجرد Stock Screener يعطي قائمة أسهم.

نحن نبني **Decision Funnel** كامل:

**\~9,800 سهم أمريكي**
**→ تنظيف البيانات**
**→ استبعاد غير القابل للتداول**
**→ فلترة المخاطر غير المدفوعة**
**→ تشغيل استراتيجيتين مختلفتين**
**→ ترتيب المرشحين**
**→ Deep Verification**
**→ قائمة صغيرة جدًا تستحق البحث البشري.**

فلسفة النظام تكون:

> **The system does not tell us what to buy. It tells us where it is worth looking.**

وهذا متوافق تمامًا مع الاستنتاج النهائي في الـREADME القديم: الأداة قوية أكثر كوسيلة لتجنب الكوارث وتصغير السوق إلى قائمة بحث، وليست آلة قرار شراء مستقلة.

التطبيق يبقى:

- PWA.
- Mobile-first.
- عربي RTL.
- قابل للتثبيت.
- سريع جدًا عند الفتح.
- آخر Scan محفوظ في قاعدة البيانات.
- زر واضح لـ **فحص السوق**.
- كل نتيجة مربوطة بتاريخ البيانات ونسخة الخوارزمية التي أنتجتها.

البنية الأصلية نفسها أثبتت أنها مناسبة: TanStack Start + Cloudflare Workers + D1، مع طبقة منفصلة للـvalidation.

---

# 2. أهم قرار معماري: Strategy Engine واحد، وليس معادلتين مبعثرتين

حتى مع وجود Core وBounce، لا أريد ملفين كل واحد يعمل بطريقته الخاصة.

سنصمم:

```text
Strategy Engine
│
├── Shared Data Model
├── Shared Gate Engine
├── Shared Scoring Engine
├── Shared Evidence/Provenance
│
├── CORE_VALUE_V2 Strategy Spec
│
└── BOUNCE_V2 Strategy Spec
```

بمعنى:

```ts
evaluateStrategy("core_value", metrics)
evaluateStrategy("bounce", metrics)
```

لكن المنطق العام واحد.

كل Strategy تعرف داخل Configuration Object:

```ts
{
  id,
  version,
  gates,
  weights,
  rankingRules,
  exitRules,
  requiredMetrics
}
```

لا يوجد Threshold مكتوب يدويًا في `market.functions.ts` ثم نسخة ثانية في `score.ts`.

هذه مشكلة حصلت فعليًا في النسخة السابقة عندما كانت الـpipeline تستخدم حدودًا مختلفة عن محرك التقييم، مما جعل الشركات تحت 200M لا تصل أصلًا رغم أن البوابة الفعلية كانت أقل. الـPDF يذكر صراحة أن الحل كان اشتقاق الحدود من `score.ts` بدل تكرارها.

### قاعدة إلزامية

أي threshold يوجد **مرة واحدة فقط**.

مثلًا:

```ts
CORE_VALUE_SPEC.marketCap.min
CORE_VALUE_SPEC.marketCap.max
```

الـpipeline تقرأها.

الـUI تقرأها.

الـbacktest يقرأها.

الـvalidation يقرأها.

ولا يوجد hardcoded duplicate.

---

# 3. سنحتفظ بثلاثة Models وليس اثنين

هذا تحسين مهم جدًا.

| Modelدوره     |                          |
| ------------- | ------------------------ |
| Legacy Model  | Benchmark فقط            |
| Core Value V2 | الاستثمار 12–24 شهر      |
| Bounce V2     | فرصة ارتداد قصيرة نسبيًا |

## Legacy Model

لن يظهر للمستخدم في الصفحة الرئيسية.

لكنه يبقى داخل Research Harness حتى نسأل دائمًا:

> هل التعديل الجديد فعلاً أفضل من النظام القديم، أم فقط يبدو أكثر تعقيدًا؟

الـLegacy baseline الموثق:

- Market cap: `$50M–$5B`
- Dollar volume ≥ `$300k/day`
- P/S ≤ 10
- Net income positive OR FCF positive

ثم:

- Valuation 25
- Profitability/FCF 20
- Momentum 20
- Dilution 15
- Size 10
- Insider 10

المجموع = **100**.

هذا سيكون control group دائم.

---

# 4. CORE VALUE V2

هذه ليست قائمة هدفها البيع عند +20%.

هدفها:

**12–24 شهر، مع إعطاء الأولوية للشركات الرخيصة والصغيرة والقابلة للبقاء.**

والـPDF نفسه يحذر أن قدرة Core على اصطياد الانفجارات لم تكن قوية إحصائيًا بما يكفي للاعتماد عليها وحدها، بينما حماية الانهيار كانت أقوى.

لذلك الاسم الداخلي الأفضل:

```text
Core Value / Survival + Upside
```

وليس:

```text
100% Stock Finder
```

---

## 5. Core Value — مرحلة Gates

قبل أي Score، يجب على الشركة المرور عبر جميع Hard Gates.

### Gate 1 — Size

```text
$25M ≤ Market Cap ≤ $2B
```

كما في النسخة الأحدث.

نقسم داخليًا الحجم إلى buckets لأن صغر الحجم قد يحمل upside لكن أيضًا risk:

```text
25–75M
75–200M
200–500M
500M–1B
1B–2B
```

لا نعطي الأصغر تلقائيًا أفضلية؛ الـScore يقرر بعد اختباراتنا.

---

## 6. Gate 2 — Liquidity

الموثق:

```text
Dollar Volume ≥ $150k/day
```

لكن في التطبيق سنحسب أكثر من metric:

```text
20-day median dollar volume
30-day median dollar volume
90-day average dollar volume
```

الـGate production يبقى على metric واحد ثابت ومحدد في Strategy Spec.

الـothers للتشخيص.

لماذا median؟

حتى لا يجعل يوم volume ضخم واحد سهمًا غير سائل يبدو سائلًا.

### يجب أن يكون لدينا:

```text
Liquidity Status:
PASS
BORDERLINE
FAIL
UNKNOWN
```

**UNKNOWN ≠ PASS.**

وهذه قاعدة أساسية من النظام السابق: عدم معرفة البيانات لا يعتبر نجاحًا.

---

# 7. Gate 3 — Revenue Base + EV/Sales

الـCore الأحدث يطلب:

```text
EV/S ≤ 10
+
Actual revenue base
```

وهذا مهم جدًا.

شركة biotech قبل الإيرادات مثلًا لا تدخل لمجرد أن Yahoo يعيد metric غريبًا.

نعرف:

```text
hasRevenueBase =
TTM Revenue > 0
AND
Revenue source freshness acceptable
```

ثم:

```text
EV/S = Enterprise Value / TTM Revenue
```

ونخزن أيضًا:

```text
P/S
EV/S
EV/EBITDA
P/E
FCF Yield
```

ولكن لا نخلطهم في gate بدون validation.

---

# 8. Gate 4 — Profitability or Inflection

الـPDF يقول:

```text
Actual profitability OR inflection toward profitability
```

لكن **الREADME لا يعطينا تعريفًا رياضيًا كاملًا للـinflection**.

لذلك لن أخترع threshold وأقول إنه الأصلي.

سنبنيها بهذه الطريقة.

### Profitability — Definitive branch

```text
Net Income TTM > 0
OR
Free Cash Flow TTM > 0
```

هذا متوافق مع المحرك الأقدم أيضًا.

### Inflection — Research branch

نجمع:

```text
Operating margin improvement
Gross margin trend
FCF loss reduction
Operating cash flow improvement
Net loss reduction
Revenue stability
Cash burn trend
```

ونختبر combinations مختلفة.

مثلًا Candidate Rule:

```text
Operating Margin improves YoY
AND
FCF burn shrinks materially
AND
Revenue does not collapse
```

لكنها لا تصبح production gate قبل نجاح:

```text
development
→ time split
→ locked firm holdout
```

---

# 9. Gate 5 — No Death Spiral

هذا من أهم الفلاتر.

الـPDF يقول صراحة:

```text
no-death-spiral
```

والفلسفة العامة للمشروع هي رفض المخاطرة غير المدفوعة: cash burn، leverage، dilution، pre-revenue speculation.

سنحول ذلك إلى Risk Gate له subchecks:

```text
Cash runway
Share dilution
Debt burden
Interest burden
Negative FCF persistence
Going-concern risk
Extreme reverse splits
Repeated equity offerings
Revenue collapse
Current liabilities pressure
```

بدل:

```text
deathSpiral = true/false
```

سيكون:

```text
Death Spiral Risk
0 = clean
1 = mild
2 = elevated
3 = severe
```

Production gate:

```text
severe → FAIL
unknown critical data → INCOMPLETE
```

وليس PASS.

---

# 10. Core Value — Score

بعد المرور من الـGates فقط تبدأ الدرجة.

الأوزان الموجودة في النسخة الأحدث:

| FactorWeight              |         |
| ------------------------- | ------- |
| Valuation                 | 24      |
| Quality                   | 19      |
| Share Discipline          | 15      |
| Small Size + Low Coverage | 14      |
| Growth                    | 7       |
| Insider Buying            | 7       |
| Margin Trend              | 6       |
| Entry Point               | 5       |
| Balance Sheet             | 3       |
| **TOTAL**                 | **100** |

وهذا يطابق الجدول في الـPDF.

راجعت الجمع أيضًا:

```text
24+19+15+14+7+7+6+5+3 = 100
```

---

# 11. كيف نحسب كل Factor؟

هنا أريد تطويرًا مهمًا عن النسخة السابقة.

لا نريد magic scores.

كل Factor يعيد:

```ts
{
  rawValue,
  normalizedScore,
  maxPoints,
  earnedPoints,
  source,
  asOf,
  confidence,
  explanation
}
```

مثلًا:

```text
Valuation
Raw:
EV/S = 1.45
P/S = 1.20
FCF Yield = 4.8%

Normalized = 0.78
Points = 18.7 / 24
```

كل نقطة يجب أن تكون قابلة للتفسير.

---

# 12. Valuation — 24

نستخدم valuation ensemble بدل ratio واحد.

Inputs الممكنة:

```text
EV/S
P/S
P/E if meaningful
EV/EBITDA if meaningful
FCF yield
Historical valuation range
```

لكن ننتبه لدرس مهم من الـREADME القديم:

عامل valuation الذي كان الأقوى بدأ يتآكل عبر السنوات ووصل إلى lift ≈1.03 في آخر سنة مذكورة. لذلك لا يجوز بناء النظام كله عليه.

لذلك سنجعل dashboard يظهر:

```text
Valuation Factor Stability
Strong / Weak / Decaying
```

ويحسب سنويًا من الـbacktests.

---

# 13. Quality — 19

لا أعطي Quality معنى فضفاضًا.

يُبنى من:

```text
FCF quality
Operating cash conversion
Profitability
Revenue quality
Gross margin
Customer concentration if available
Cash burn
Accrual quality
```

لكن أي component لا نملك له بيانات reliable لا يدخل silently.

---

# 14. Share Discipline — 15

من أهم عوامل small caps.

نحسب:

```text
Shares outstanding YoY
Shares outstanding 2Y
Share-based compensation
Equity offerings
ATM programs
Reverse splits
```

Simple base metric:

```text
Dilution % =
(Current Shares - Previous Shares)
/
Previous Shares
```

لكن Corporate Actions يجب تعديلها.

لا يجوز أن نعتبر stock split تخفيفًا.

---

# 15. Small Size + Weak Coverage — 14

هذه محاولة لالتقاط **paid risk**:

```text
small company
+
underfollowed
+
actual business
+
adequate liquidity
```

وليس:

```text
tiny illiquid company = good
```

Inputs:

```text
Market cap
Analyst count
Institutional coverage if available
News coverage
Trading liquidity
```

لكن weak coverage لا تصبح positive signal إلا إذا البيانات الأساسية قوية.

---

# 16. Growth — 7

السبب أن وزنه صغير مهم.

الـPDF يقول إن عوامل مثل نمو الإيرادات العالي لم تؤدِ جيدًا كما كان متوقعًا، ولذلك خُفض وزنها.

والـREADME الأقدم وجد أن `Revenue Growth ≥15%` أعطى lift ≈1.00.

إذن لا نفعل:

```text
High growth = automatic good
```

بل:

```text
Growth quality
+
growth consistency
+
margin response
```

---

# 17. Insider Buying — 7

هذه يجب أن تبقى صارمة.

SEC Form 4.

فقط:

```text
Transaction Code P
```

أي شراء open-market بأموال جديدة.

لا نحسب:

```text
A = awards
M = option exercise
S = sale
```

كشراء إيجابي.

هذا درس موثق صراحة في النظام القديم.

نخزن:

```text
buyers_count
buy_value
buy_value / market_cap
cluster_buying
days_since_buy
CEO/CFO/director
```

---

# 18. Margin Trend — 6

Inputs:

```text
Gross margin YoY
Operating margin YoY
FCF margin YoY
```

لكن الـPDF نفسه يشير إلى أن توسيع الهوامش لم يعطِ lift قويًا في بعض الاختبارات، لذلك وزنه منخفض.

---

# 19. Entry Point — 5

هذا يجب أن يبقى عاملًا صغيرًا.

لأن أحد الدروس المهمة كان أن "القرب من القاع" ليس بالضرورة جيدًا؛ كان مرتبطًا بانهيارات مرتفعة في القياس المذكور.

Inputs:

```text
Distance from 52w high
Distance from 52w low
6m momentum
12m momentum
30-week MA
Volume trend
```

لكن ليس:

```text
Closer to low = higher score
```

---

# 20. Balance Sheet — 3

صغير عمدًا.

لأن النسخة القديمة وجدت أن clean balance sheet وحدها لم تعطِ lift قويًا.

لكن تبقى مهمة كـrisk diagnostic.

Inputs:

```text
Net cash/debt
Debt/equity
Current ratio
Interest coverage
Cash runway
```

---

# 21. BOUNCE MODE V2

هذا **نظام مختلف جذريًا**.

لا نستخدم Core Score ونغير الألوان.

هدفه:

> دخول بعد انهيار كبير عندما تظهر علامات انعكاس، والخروج عند +20% أو -15% أو بعد 3 أشهر.

هذا هو السلوك الذي يذكر الـPDF أنه أقرب لسلوك المستخدم الفعلي.

---

# 22. Bounce Gate 1 — Actual Collapse

```text
12-month price decline > 35%
```

أي:

```text
return_12m < -35%
```

---

# 23. Bounce Gate 2 — Not Catching Absolute Bottom

السعر يجب أن يكون:

```text
≥ 10% above 52-week low
```

أي:

```text
price / low52w - 1 >= 0.10
```

الهدف:

```text
Don't catch a falling knife at the absolute low.
```

---

# 24. Bounce Gate 3 — Size

```text
$25M–$600M
```

---

# 25. Bounce Gate 4 — Liquidity

يجب أن يكون tradable فعليًا.

وهنا سأكون أشد من مجرد minimum واحد.

نحتاج:

```text
Median Dollar Volume
Spread estimate if available
Volume consistency
No repeated zero-volume days
```

ولا نسمح للـOTC.

الـPDF يذكر صراحة sufficient liquidity + non-OTC.

---

# 26. Bounce Gate 5 — Dilution

```text
Dilution < 25%
```

لكن production calculation يجب أن يصحح:

```text
splits
mergers
stock compensation anomalies
```

---

# 27. Bounce Gate 6 — Confirmed Reversal

هذه من أقوى أجزاء المشروع.

الفلتر الذي نجح:

```text
Price > 30-week MA by more than 5%
```

أي:

```text
price > MA30W × 1.05
```

وقد رفع hit rate في holdout من حوالي 46% إلى 54.8% بحسب الملف، بينما بدائل 50/200-day MA لم تنجح بنفس الشكل.

إذن:

### ممنوع

```text
MA50
MA200
Golden Cross
RSI
MACD
```

كشروط Production فقط لأنها شائعة.

إذا أردنا إضافتها:

```text
Research Candidate
→ backtest
→ locked holdout
→ only then production
```

---

# 28. Bounce Exit Engine

Rule ثابت:

```text
Take Profit: +20%
Stop Loss: -15%
Maximum Holding Period: 3 months
```

هذه ليست فقط UI information.

يجب أن تكون موجودة في:

```text
Backtest Engine
Paper Portfolio
Signal Detail
Exit Simulation
```

---

# 29. مشكلة Backtesting مهمة جدًا للـBounce

لو في يوم واحد:

```text
High = +22%
Low = -17%
```

لا نعرف من daily OHLC أيهما حصل أولًا.

إذن لن نفترض أننا ربحنا.

سنستخدم conservative rule:

```text
If both target and stop were touched in same daily bar:
assume STOP hit first
```

أو نستخدم intraday data إذا توفر.

هذه نقطة مهمة جدًا لمنع optimistic bias.

---

# 30. هل نعطي Bounce Score من 100؟

مصدر المشروع لا يعطينا Score موثق كامل مثل Core.

لذلك لن أخترع "الأوزان الأصلية".

اقتراحي:

```text
Qualification = binary
+
Research Ranking = 0–100
```

لكن Ranking لا يصبح production signal إلا بعد اختباره.

Candidate dimensions:

```text
Reversal strength
Liquidity
Dilution
Distance from low
Not-too-extended condition
Volume confirmation
Financial survivability
```

في النسخة الأولى:

**Gates هي التي تحدد الدخول إلى Bounce List.**

ثم ترتيب بسيط وغير متدخل:

```text
confirmed reversal strength
+
liquidity quality
```

ونختبر scoring لاحقًا.

---

# 31. نتائج Bounce التي نعتبرها Benchmark

الـPDF يذكر:

```text
+20% target hit ≈ 47.2%
vs
≈37.2% random comparison
```

كما يذكر أداءً تقريبيًا أعلى من Core في التجربة المذكورة.

هذه ليست promises.

نستخدمها كـ:

```text
Historical benchmark to reproduce
```

أي أول test لنا:

> هل backtest engine الجديد يستطيع إعادة إنتاج هذه النتيجة تقريبًا على نفس dataset؟

إذا لا، شيء ما تغير في:

```text
data
rules
date alignment
corporate actions
exit logic
```

ولا نكمل قبل تفسيره.

---

# 32. Data Architecture

هذه ربما أهم من الـScore نفسه.

سنفصل:

```text
Raw Data
↓
Normalized Data
↓
Derived Metrics
↓
Strategy Evaluation
↓
Results
```

ولا يسمح لـScore بالاتصال مباشرة بـYahoo أو SEC.

---

# 33. مصادر البيانات

من النظام القديم:

### SEC

لـ:

```text
Ticker → CIK
Company Facts
XBRL Frames
Submissions
Form 4
```

وكانت Frames هي مفتاح القدرة على فحص آلاف الشركات بدل طلب لكل شركة.

### Yahoo

لـ:

```text
Quotes
Historical chart
Company profile
Analyst data
Earnings
News
```

مع آلية crumb/cookie التي وثقها النظام.

---

# 34. SEC Normalization Engine

هذه ليست optional.

يجب أن نعيد تطبيق جميع الدروس القديمة.

### Revenue tags

لا نأخذ أول XBRL tag وننتهي.

نبحث في مجموعة tags ونختار observation الصحيح حسب:

```text
period
filed_at
form
freshness
```

لأن الإيرادات تغيّرت tags تاريخيًا.

### CAPEX

استخدام:

```text
PaymentsToAcquirePropertyPlantAndEquipment
```

وليس:

```text
PaymentsToAcquireProductiveAssets
```

كما تعلم المشروع من الخطأ السابق.

### Annual Cash Flow

يؤخذ من:

```text
10-K
20-F
40-F
```

ولا نجمع Q1 + Q2 YTD + Q3 YTD.

لأن 10-Q cash flow data cumulative YTD.

### Foreign filers

لا نستبعدهم silently.

نعلم:

```text
foreignFiler = true
data_frequency = annual/semiannual
```

ونعرض تحذيرًا.

---

# 35. Metric Provenance

كل رقم نعرضه يجب أن يحمل داخليًا:

```text
value
currency
period_start
period_end
filed_at
available_at
retrieved_at
source
source_document
source_tag
confidence
```

مثال:

```json
{
  "metric": "revenue_ttm",
  "value": 182400000,
  "period_end": "2026-06-30",
  "available_at": "2026-08-07",
  "source": "SEC",
  "confidence": "high"
}
```

هذا أساس الـpoint-in-time backtesting.

---

# 36. Two-Source Verification Layer

أحد قواعد المشروع:

> أي رقم مالي حساس، خصوصًا valuation، يجب التحقق منه من مصدرين في نفس الفترة.

لكن تنفيذ ذلك على 9,800 شركة لكل metric مكلف وغير ضروري.

إذن:

### Market Scan

```text
Primary trusted source
```

### Candidate Enrichment

لأفضل الشركات فقط:

```text
Source A
vs
Source B
```

ثم:

```text
difference <= tolerance → VERIFIED
difference > tolerance → CONFLICT
missing source → SINGLE_SOURCE
```

---

# 37. Financial Data Confidence

سنضيف metric جديد ليس للScore:

```text
Data Confidence
```

مثال:

```text
A = all critical metrics fresh and verified
B = one secondary source missing
C = older filing / foreign filer
D = critical contradiction
F = insufficient
```

شركة D/F:

**لا تدخل Final Ranking.**

---

# 38. قاعدة "الأربع زوايا"

الـPDF يطلب ألا تدخل شركة النهائي إذا كانت ناقصة إحدى زوايا البحث، وأن تُعرض خارج الترتيب مع النقص.

سنحول ذلك إلى مرحلة:

## Research Complete Gate

المرشح النهائي يجب أن يحتوي:

```text
1. Financial Results
2. Historical / Self Valuation Context
3. Analyst Expectations
4. Sector / Business Cycle Context
```

إذا:

```text
3/4
```

نكتب:

```text
Qualified Screener Candidate
Research Incomplete
Not Final Ranked
```

هذه نقطة ممتازة لأنها تمنع algorithmic false confidence.

---

# 39. Universe Cleaning

قبل الـCore/Bounce:

```text
US listed equities
```

ونحدد أنواع الأوراق المالية.

أقترح استبعاد افتراضيًا:

```text
ETFs
ETNs
Funds
Warrants
Rights
Preferred stock
Shells
OTC
```

والـMLP/K-1 يوضع له flag خاص لأن ملف المشروع طلب تجنبه.

Foreign operating companies المدرجة في US يمكن إبقاؤها مع `foreignFiler` handling.

---

# 40. Database الجديدة

أقترح D1 tables التالية:

```text
companies
securities
quote_snapshots
price_history
fundamental_facts
fundamental_snapshots
technical_snapshots
insider_transactions
analyst_snapshots
company_profiles
news_cache

strategy_configs
strategy_runs
strategy_results
strategy_checks

data_quality_flags
source_conflicts

job_state
pipeline_runs
diag

watchlist
favorites

backtest_runs
backtest_trades
backtest_metrics
holdout_sets
experiment_registry
```

---

# 41. لماذا snapshots وليست latest-only؟

لأن إذا حفظنا فقط:

```text
revenue = current
```

لن نستطيع بعد 6 أشهر أن نعرف:

> ما الذي كان معروفًا في 2025-06-01؟

لذلك نحتاج:

```text
available_at
```

وhistory.

وهذا هو الفرق بين:

```text
Backtest
```

و:

```text
Look-ahead simulation
```

---

# 42. Scan Pipeline الجديد

القديم كان ثلاث مراحل: quotes → frames → scoring، بسبب حدود Worker.

سنوسعها إلى:

```text
Stage 0 — Universe Sync
Stage 1 — Bulk Quotes
Stage 2 — Security Type Cleaning
Stage 3 — Preliminary Size/Liquidity Filter
Stage 4 — SEC Bulk Fundamentals
Stage 5 — Normalize Fundamentals
Stage 6 — Core Preliminary Gates
Stage 7 — Bounce Preliminary Gates
Stage 8 — Technical Data for surviving Bounce names
Stage 9 — Score / Evaluate Strategies
Stage 10 — Deep Enrichment for top candidates
Stage 11 — Secondary-source verification
Stage 12 — Final ranking
Stage 13 — Persist run
```

كل Stage:

```text
idempotent
resumeable
checkpointed
```

---

# 43. Never Start Over

`job_state` يخزن:

```text
run_id
stage
offset
processed
success
failed
started_at
heartbeat
```

إذا توقف Worker:

```text
Resume from last offset
```

وليس إعادة 9,800 سهم.

---

# 44. Stale Results Protection

النسخة القديمة كانت تخزن النتائج في D1 ولا تتغير تلقائيًا عندما نغير المعادلة. لذلك كان يجب الضغط على "فحص السوق".

الجديدة ستكون أذكى.

كل Result يخزن:

```text
strategy_version
strategy_hash
data_snapshot_version
```

لو الـcurrent strategy hash ≠ result strategy hash:

```text
STALE RESULT
```

والواجهة تقول:

```text
تم تعديل الخوارزمية.
أعد فحص السوق للحصول على نتائج جديدة.
```

---

# 45. Version Everything

مثال:

```text
CORE_VALUE_V2.0.0
BOUNCE_V2.0.0
```

إذا عدلنا Weight:

```text
2.0.1
```

إذا عدلنا Gate:

```text
2.1.0
```

إذا غيرنا تعريف الاستراتيجية جذريًا:

```text
3.0.0
```

كل backtest مرتبط بالversion.

---

# 46. UI الرئيسية

أقترح Tabs:

```text
الرئيسية
القيمة
الارتداد
البحث
المفضلة
مختبر النتائج
```

### أعلى الصفحة

```text
آخر فحص
عدد الأسهم
عدد المؤهلة
عدد المستبعدة
عدد ناقصة البيانات
Data freshness
```

### زر

```text
فحص السوق
```

مع progress حقيقي:

```text
1,842 / 9,817
19%
```

---

# 47. Core Card

كل بطاقة:

```text
Ticker
Company
Price
Market cap
Core Score
Qualification
Top 3 reasons
Main risk
Data confidence
Last updated
```

مثال:

```text
84/100

+ رخيصة بالنسبة للإيرادات
+ تدفق نقدي موجب
+ لا تخفيف ملحوظ

⚠ تغطية محللين ضعيفة
```

---

# 48. Bounce Card

لا نخلطها مع Core.

تظهر:

```text
12m decline
Distance from 52w low
30W MA confirmation
Dilution
Liquidity
Entry price
Target +20%
Stop -15%
Time exit date
```

---

# 49. Excluded Tab

هذه مهمة جدًا.

لا نرمي الشركات في الصمت.

مثلًا:

```text
XYZ
Excluded

✕ Market cap too large
✓ Liquidity
✓ Revenue
✓ Profitability
```

وبالتالي نفهم لماذا لم تدخل.

---

# 50. Incomplete Tab

مختلف عن excluded.

```text
ABC
Potential candidate
Missing:
SEC cash flow data
```

لا نعاقب الشركة بإعطائها 0.

ولا نسمح لها بالدخول كأنها PASS.

---

# 51. Company Detail

أقسام:

```text
Overview
Why it qualified
Score breakdown
Financials
Valuation
Price chart
Insiders
Analysts
News
Sector
Risks
Data quality
Sources
```

---

# 52. Chart

خمسة ranges مثل المشروع السابق، مع:

```text
1M
6M
1Y
2Y
5Y
```

لـBounce نضيف:

```text
52W low
30W MA
Entry
Target
Stop
```

---

# 53. Translation

النسخة القديمة تعلمت أن server-side translation قد تفشل من datacenter IPs، ولذلك كانت الترجمة client-side مع caching في `localStorage`.

نحتفظ بهذا المبدأ:

```text
Original English always stored.
Translation = presentation layer.
```

إذا فشلت:

```text
show English
```

وليس صندوقًا فارغًا.

---

# 54. Statistical Validation Lab

هذا الجزء بالنسبة لي **أهم من الواجهة كلها**.

المجلد:

```text
app/tools/
```

يحتوي تقريبًا:

```text
fetch.ts
pit.ts
score.ts
validate.ts
disasters.ts
holdouts.ts
bootstrap.ts
multiple-testing.ts
bounce-exits.ts
reproduce.ts
```

الـPDF يوثق أصلًا استخدام أدوات منفصلة للـfetch والـpoint-in-time والـvalidation والـdisaster checks.

---

# 55. Point-in-Time Validation

قاعدة مطلقة:

عند simulation بتاريخ:

```text
2023-06-30
```

لا يجوز استخدام filing نُشر:

```text
2023-08-01
```

حتى لو كان fiscal quarter انتهى في يونيو.

الـREADME القديم وجد median reporting delay قريبًا من 39 يومًا واستخدم 60 يومًا في الاختبارات لمنع التسريب.

الجديد الأفضل:

بدل 60-day approximation إذا كان `filed_at` متاحًا:

```text
available_at = actual filing timestamp
```

ونستخدمه.

60 يوم fallback فقط إذا لا يوجد filing timestamp.

---

# 56. Locked Firm Holdouts

هذه واحدة من أهم الدروس في المشروع كله.

الـPDF يوضح أن time split وحده لم يكن كافيًا؛ التحسينات كانت تنجح ثم تموت عند اختبار شركات لم يرها النموذج. لذلك يجب عزل الشركات نفسها.

سنستخدم:

```text
Train firms
Validation firms
Locked holdout firms
Final untouched firms
```

والـholdout membership يولد من:

```text
hash(ticker + permanentSalt)
```

لا نبدله عندما لا تعجبنا النتيجة.

---

# 57. Nested Testing

أي فكرة جديدة:

```text
Research
↓
Development sample
↓
Validation
↓
Locked firm holdout
↓
Final holdout
```

إذا شاهدنا Final Holdout:

**انتهى دوره كـfinal.**

نحتاج مجموعة جديدة مستقبلًا.

---

# 58. Multiple Testing

الـREADME نفسه يذكر مشكلة أن عشرات الاختبارات تخلق false discoveries ويقترح تصحيحًا مثل Bonferroni/Deflated Sharpe.

سننشئ:

```text
experiment_registry
```

كل تجربة:

```text
id
hypothesis
parameters
created_at
dataset_version
result
p_value
adjusted_p
holdout_result
status
```

وبذلك لا نستطيع بعد 80 محاولة أن نعرض فقط المحاولة التي نجحت.

---

# 59. Company-Level Bootstrap

لا نحسب observations الربعية لنفس الشركة كأنها شركات مختلفة.

النسخة القديمة أصلحت هذا الخطأ بالفعل.

إذن bootstrap sampling unit:

```text
firm
```

وليس:

```text
row
```

---

# 60. Survivorship Bias

هذه أكبر فجوة إحصائية باقية.

الـREADME القديم يعترف أن الشركات المشطوبة غير ممثلة كاملًا، وبالتالي crash rates الحقيقية غالبًا أسوأ.

الخطة:

### Free version

نعرض:

```text
Survivorship Bias Warning
```

### Serious validation version

نحتاج dataset يشمل:

```text
delisted
bankrupt
acquired
ticker changes
```

وإلا لا نقول:

```text
true historical market failure rate
```

---

# 61. Transaction Costs

النظام القديم ركز على returns، لكن النسخة الجديدة يجب أن تحسب:

```text
commission
bid/ask spread
slippage
```

خصوصًا Bounce.

مثال simulation:

```text
Entry = next tradable price
+ slippage
Exit = rule price
- slippage
```

ونجرب:

```text
0 bps
25 bps
50 bps
100 bps
```

إذا الاستراتيجية تموت عند 50bps:

هذه مشكلة حقيقية.

---

# 62. Liquidity Stress Test

لكل استراتيجية:

```text
$100k
$150k
$250k
$500k
$1M
```

daily dollar volume.

نقيس:

```text
hit rate
annualized return
candidate count
drawdown
```

وهذا يمنع تكرار الفكرة التي نجحت إحصائيًا فقط في الأسهم شبه غير القابلة للتداول؛ الـPDF يذكر مثالًا واضحًا على نموذج +30% اليوم التالي الذي انهار عمليًا بعد فرض فلتر سيولة واقعي.

---

# 63. Core Metrics

لا نقيس فقط:

```text
% that doubled
```

بل:

```text
Median 12m return
Median 24m return
Mean return
CAGR
Max drawdown
Probability of -50%
Probability of +50%
Probability of +100%
Win rate
Loss rate
Tail loss
Expected value
Coverage
Turnover
```

---

# 64. Bounce Metrics

الأهم:

```text
Hit +20 before -15
Hit -15 before +20
Time exit
Average days held
Median return
Expected trade return
Annualized return
Max drawdown
Trades/year
Slippage sensitivity
```

وأيضًا:

```text
Conditional results by:
Market cap
Liquidity
Year
Sector
Dilution bucket
Drawdown bucket
```

---

# 65. Sector Handling

لا نضع:

```text
AI sector +10 points
Biotech +10 points
```

لمجرد أنها قطاعات مثيرة.

النسخة القديمة اختبرت sector effect ووجدت أن الأفضل يتغير عبر السنوات، لذلك أبقته كتحذير وليس كجزء من الدرجة.

سنحافظ على ذلك.

في Detail:

```text
Sector Risk
Sector Cycle
Sector Dispersion
```

لكن:

```text
not score by default
```

إلا إذا أثبت اختبار جديد غير ذلك على holdout.

---

# 66. Disaster Tests

`disasters.ts` يجب أن يكون له هدف محدد:

البحث عن:

```text
-50%
-70%
bankruptcy
delisting
massive dilution
going concern
reverse split sequences
cash exhaustion
debt restructuring
```

ثم نسأل:

> لماذا مرّت هذه الشركة؟

هذا أهم من سؤال:

> لماذا لم نلتقط الشركة التي ارتفعت 300%؟

---

# 67. Adversarial Dataset

سننشئ dataset مصطنع لاختبار المحرك.

مثلًا:

### Company A

```text
Cheap
profitable
low dilution
```

يجب أن تمر.

### Company B

```text
Cheap
but no revenue
```

يجب أن تفشل.

### Company C

```text
great numbers
market cap too large
```

تفشل.

### Company D

```text
all metrics good
critical metric unknown
```

INCOMPLETE.

### Company E

```text
bounce -50%
but still sitting at exact 52w low
```

FAIL Bounce.

### Company F

```text
-50%
+15% from low
but below MA30W
```

FAIL confirmation.

### Company G

```text
passes all Bounce
```

PASS.

---

# 68. Unit Test Suite

يجب أن يغطي على الأقل:

```text
Market cap boundaries
Liquidity boundaries
EV/S boundaries
Profitability
Inflection
Death spiral
Dilution calculation
Stock splits
Foreign filers
Annual cash flow
Revenue tags
Insider code P
MA30W
Bounce distance from low
Bounce target
Bounce stop
Time exit
Unknown-data handling
Score total
Strategy versioning
```

---

# 69. Boundary Tests

مثل:

```text
Market cap = 24,999,999 → FAIL
25,000,000 → PASS
2,000,000,000 → PASS
2,000,000,001 → FAIL
```

وللBounce:

```text
decline = -34.99% → FAIL
-35.01% → PASS
```

حسب اختيارنا `>` أو `>=`.

يجب تثبيت semantics بدقة.

---

# 70. Invariant Tests

هذه ممتازة.

### Invariant 1

```text
WEIGHT_TOTAL === 100
```

### Invariant 2

أي company تفشل Gate:

```text
qualified === false
```

مهما كان Score.

### Invariant 3

```text
UNKNOWN Gate !== PASS
```

### Invariant 4

نفس input + same strategy version:

```text
same result
```

### Invariant 5

Core change:

```text
must not change Bounce result
```

إلا إذا تغير shared data.

---

# 71. Integration Tests

نختار شركات حقيقية ثابتة لأغراض QA.

لكل شركة نخزن expected:

```text
SEC revenue
cash flow
share count
market cap
Form 4
```

ونشغل:

```text
Source
→ parser
→ normalized metric
→ score
→ UI
```

---

# 72. Data Freshness Tests

إذا Yahoo quote عمره:

```text
3 days
```

يظهر stale.

إذا SEC fundamentals قديمة بسبب foreign filer:

```text
show warning
```

إذا market scan نصفه جديد ونصفه قديم:

```text
run invalid / partial
```

ولا نقول "Scan completed".

---

# 73. Failure Injection

نعطل عمدًا:

```text
SEC
Yahoo
D1 write
translation service
one scan batch
network
```

ونرى:

```text
Does app recover?
Does it resume?
Does it corrupt results?
```

---

# 74. Migration Tests

قاعدة من النسخة القديمة:

migration قديمة لا يعاد تطبيقها؛ أي schema change يحتاج migration جديدة.

إذن:

```text
0001_initial.sql
0002_market.sql
0003_strategies.sql
0004_backtests.sql
...
```

لا نعدل `0001` بعد production.

---

# 75. Performance Testing

Targets:

```text
App open < fast enough from cached scan
No scanning on normal page open
Market scan resumable
No Worker timeout kills full process
```

نختبر:

```text
1,000
3,000
5,000
10,000
15,000 symbols
```

حتى نعرف ceiling.

---

# 76. Security

لن نكرر مشكلة credentials الموجودة في README.

في المشروع الجديد:

```text
.env
Cloud secrets
```

وليس:

```text
README
source code
git history
```

ونعمل secret scanning قبل push.

أي credentials قديمة ظهرت سابقًا تعتبر compromised ويجب عدم إعادة استخدامها.

---

# 77. Observability

`diag` يتطور إلى نظام كامل.

كل Scan يظهر:

```text
Universe count
Quotes success/fail
SEC success/fail
Fundamental coverage
Core qualified
Bounce qualified
Incomplete
Excluded
Duration
API errors
Data conflicts
```

---

# 78. Data Coverage Dashboard

مثال:

```text
Universe              9,812
Price                 9,731  99.2%
Market cap            9,410  95.9%
Revenue               7,820  79.7%
Cash flow             6,910  70.4%
Share count           7,390  75.3%
Insider detailed      on-demand
Analysts detailed     on-demand
```

هذه الشاشة ستكشف المشاكل قبل أن تغير النتائج بصمت.

---

# 79. Audit Trail

كل مرشح يجب أن نستطيع بعد شهر أن نقول:

```text
Why was XYZ ranked #4?
```

والجواب يأتي من DB:

```text
Run: 2026-09-05-001
Strategy: CORE_VALUE_V2.0.3
Data as of: ...
Score: ...
Checks: ...
Sources: ...
```

---

# 80. Research Lab

أريد داخل المشروع مجلدًا منفصلًا:

```text
research/
```

وليس التلاعب مباشرة بالـproduction score.

Workflow:

```text
idea
→ research experiment
→ report
→ validation
→ approval
→ strategy version bump
```

---

# 81. فكرة جديدة لا تدخل Production مباشرة

مثلًا:

> "AI stocks look strong. Add sector points."

لا.

نقوم:

```text
experiment_sector_weight_v1
```

ونختبر.

إذا يفشل:

```text
status = rejected
reason = ...
```

ونحفظه.

حتى لا يأتي شخص بعد 6 أشهر ويعيد نفس التجربة.

---

# 82. Rejected Ideas Registry

نحافظ على سجل مثل:

```text
50-day MA
200-day MA
sector bonus
30% next-day prediction
high revenue growth gate
balance-sheet gate
```

مع:

```text
why tested
sample
result
why rejected
```

هذا جزء من intelligence المشروع، وليس مجرد history.

---

# 83. خطة البناء الفعلية

أقسم المشروع إلى Milestones، وليس "اعمل التطبيق كله".

### Phase A — Specification Freeze

ننتهي من:

```text
Strategy specs
Data dictionary
Gate definitions
Score definitions
Exit rules
Unknown rules
```

لا coding قبل ذلك.

### Phase B — Repository + Core Skeleton

```text
TanStack
Tailwind
D1
PWA
migrations
routing
```

### Phase C — Market Data

```text
universe
Yahoo
historical price
caching
```

### Phase D — SEC

```text
ticker/CIK
frames
company facts
Form 4
foreign filers
normalization
```

### Phase E — Strategy Engine

```text
shared evaluator
legacy
core
bounce
```

### Phase F — Pipeline

جميع المراحل الـ14.

### Phase G — Validation Harness

```text
PIT
holdouts
bootstrap
backtests
disasters
```

### Phase H — UI

Core/Bounce/detail/search/favorites.

### Phase I — Verification Layer

```text
secondary sources
four angles
confidence
```

### Phase J — Hardening

```text
performance
failure injection
security
PWA
mobile
```

### Phase K — Shadow Run

نشغل النظام الجديد بدون الاعتماد عليه مدة.

ونقارنه بالنظام القديم.

---

# 84. شروط القبول قبل أن أقول "التطبيق جاهز"

لن أعتبر المشروع منتهيًا إلا إذا:

| TestRequired                                            |      |
| ------------------------------------------------------- | ---- |
| جميع Core weights = 100                                 | PASS |
| Legacy weights = 100                                    | PASS |
| Core/Bounce thresholds source واحد                      | PASS |
| Unknown cannot pass gate                                | PASS |
| Point-in-time audit                                     | PASS |
| Firm-level holdout                                      | PASS |
| No future filings                                       | PASS |
| Corporate-action adjustment                             | PASS |
| Bounce MA30W exact                                      | PASS |
| Bounce exits exact                                      | PASS |
| Same-day stop/target conservative                       | PASS |
| All results reproducible by run\_id                     | PASS |
| Results tied to strategy version                        | PASS |
| Old results marked stale after algorithm change         | PASS |
| Interrupted scan resumes                                | PASS |
| No secrets in repo                                      | PASS |
| Migrations forward-only                                 | PASS |
| Form 4 P-only                                           | PASS |
| Foreign filings supported                               | PASS |
| Missing four-angle research excluded from final ranking | PASS |
| No list padding                                         | PASS |
| Source conflict surfaced                                | PASS |
| Backtest includes costs/slippage                        | PASS |
| Multiple-testing correction                             | PASS |
| Survivorship limitation disclosed                       | PASS |

---

# 85. الآن عملت Red-Team للخطة نفسها: ماذا كان ناقصًا لو اكتفينا بالـREADME؟

راجعت الخطة كأنني أحاول كسرها.

وجدت عدة أشياء لم تكن معرفة بالكامل في الملفين ويجب ألا نتجاهلها:

**أولًا: تعريف** **`inflection`****.** الـPDF يطلبه لكنه لا يعطينا formula كاملة. إذن لا يجوز أن ندعي أننا نعرف formula الأصلية؛ يجب إعادة اشتقاقه واختباره.

**ثانيًا: تعريف** **`no-death-spiral`****.** الفلسفة واضحة لكن threshold الرياضية غير موثقة بالكامل. سنبني عدة candidate definitions ونختبرها.

**ثالثًا: Bounce Ranking.** Gates وexit rules موثقة، لكن score داخلي كامل غير موثق. إذن qualification يمكن إعادة بنائه بدقة، أما ranking فيجب أن يكون research-driven.

**رابعًا: survivorship bias.** بقيت مشكلة حقيقية في المصدر نفسه. لا يوجد حل مجاني كامل، لذلك يجب ألا نبالغ في claims.

**خامسًا: transaction costs/slippage.** ضروري جدًا خصوصًا في 25–600M companies، لذلك أضفته إلى الـvalidation.

**سادسًا: same-day stop/target ambiguity.** لو لم نعالجه يصبح Bounce backtest متفائلًا.

**سابعًا: corporate actions.** dilution وprice history قد يتشوهان بسبب splits.

**ثامنًا: reproducibility.** لا يكفي حفظ latest result؛ أضفنا strategy versions + run IDs + data snapshot provenance.

**تاسعًا: source disagreement.** أضفنا طبقة `source_conflicts`.

**عاشرًا: distinction بين** **`Excluded`** **و****`Incomplete`****.** هذا يمنع اعتبار missing data failure أو pass بطريقة خاطئة.

---

# 86. Requirement Traceability — هل نسينا شيئًا من الملفين؟

عملت mapping نهائي:

| Requirement from READMEsIncluded?   |   |
| ----------------------------------- | - |
| \~9,800 US stocks                   | ✓ |
| Arabic PWA                          | ✓ |
| Cloudflare/TanStack/D1 architecture | ✓ |
| Cached market scan                  | ✓ |
| Explicit Scan Market action         | ✓ |
| SEC Frames                          | ✓ |
| Yahoo bulk quotes                   | ✓ |
| XBRL tag changes                    | ✓ |
| Correct CAPEX tag                   | ✓ |
| 10-K/20-F/40-F                      | ✓ |
| 10-Q cumulative cash-flow issue     | ✓ |
| Foreign filers                      | ✓ |
| Form 4 code P only                  | ✓ |
| Client translation fallback         | ✓ |
| Single source of scoring truth      | ✓ |
| Legacy score preserved as baseline  | ✓ |
| Core Value strategy                 | ✓ |
| Core 25M–2B                         | ✓ |
| Core 150k liquidity                 | ✓ |
| EV/S ≤10 + revenue                  | ✓ |
| profitability/inflection            | ✓ |
| death-spiral protection             | ✓ |
| Core 100-point weights              | ✓ |
| Bounce -35%                         | ✓ |
| +10% from 52W low                   | ✓ |
| 25–600M                             | ✓ |
| dilution <25%                       | ✓ |
| non-OTC                             | ✓ |
| 30-week MA +5%                      | ✓ |
| +20 / -15 / 3 months                | ✓ |
| point-in-time                       | ✓ |
| locked firm holdouts                | ✓ |
| disaster testing                    | ✓ |
| multiple-testing problem            | ✓ |
| sector not blindly scored           | ✓ |
| no invented numbers                 | ✓ |
| no list padding                     | ✓ |
| incomplete research outside ranking | ✓ |
| stale-result protection             | ✓ |
| migration discipline                | ✓ |
| build/test before deploy            | ✓ |

**النتيجة: لا أرى عنصرًا جوهريًا في الملفين تركناه خارج التصميم.**

---

# 87. ما الذي أعتبره النسخة النهائية للمشروع؟

لو بنيناه بهذه الطريقة، لن يكون فقط "نسخة مشابهة" من SmallCap Radar القديم.

سيصبح:

### Layer 1 — Market Scanner

يمسح السوق.

### Layer 2 — Risk Filter

يستبعد garbage/risk غير المدفوع.

### Layer 3 — Two Independent Strategies

Core + Bounce.

### Layer 4 — Evidence Engine

يفسر كل رقم وكل نقطة.

### Layer 5 — Verification

مصادر، confidence، research completeness.

### Layer 6 — Statistical Lab

يمنعنا من خداع أنفسنا بالـbacktests.

### Layer 7 — Audit & Versioning

يعرف لماذا ظهرت كل شركة ومتى وبأي algorithm.

### Layer 8 — Human Research Funnel

يعطيك أفضل 5–30 شركة تستحق أن نعمل عليها التحليل العميق.

وهذا، برأيي، هو التطور الصحيح للفكرة الموجودة في الملفين بدل مجرد محاولة إعادة إنشاء الكود القديم حرفيًا.

**النقطة الوحيدة التي لا أريد أن نخدع أنفسنا فيها:** نستطيع إعادة بناء الاستراتيجية الموثقة بدرجة عالية جدًا من الدقة، لكن بعض التفاصيل الدقيقة داخل `Core` مثل formula الـ`inflection` و`no-death-spiral` وبعض sub-score thresholds غير موجودة بالكامل في الـREADME. لذلك سأتعامل معها كـ**Research Parameters يجب إثباتها بالبيانات**، وليس كأرقام أخترعها ثم أسميها "الخوارزمية الأصلية". وهذا بالضبط يتماشى مع فلسفة المشروع نفسه: أي معيار جديد يُقاس قبل اعتماده.

الخطوة الصحيحة التالية هي أن أحوّل هذه الخطة إلى **Technical Build Specification حرفي**: شجرة المشروع كاملة، كل جدول D1 وحقوله، كل TypeScript interface، كل function، الـAPI contracts، وتعريف `CORE_VALUE_SPEC` و`BOUNCE_SPEC` سطرًا بسطر، بحيث نستطيع بعد ذلك البدء ببناء التطبيق الجديد بدون ترك قرارات للبرمجة أثناء التنفيذ.