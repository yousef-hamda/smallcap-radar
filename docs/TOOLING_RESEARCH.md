# خارطة الأدوات ومصادر البيانات — Small Cap Radar

آخر مراجعة: 2026-09-07

هذه الوثيقة تحوّل قائمة الـMCP والمهارات والمستودعات المفتوحة إلى قرارات دمج عملية داخل التطبيق. الهدف هو رفع جودة الفحص من دون إدخال تبعيات بطيئة أو مصادر غير قابلة للتحقق.

## القرار التنفيذي

1. **مسار الإنتاج الأساسي:** طلبات HTTP مباشرة إلى SEC EDGAR وNasdaq مع التخزين المؤقت وبيانات snapshot الموقعة داخل المشروع. واجهات SEC الرسمية لا تحتاج مفتاح API، وتعرض submissions وXBRL وتُحدّث أثناء اليوم؛ لذلك فهي مناسبة لمسار Worker الحالي. [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
2. **MCP:** طبقة تنسيق وفحص للمطور/المشغّل (تشغيل فحص، قراءة provenance، مقارنة مزودين، smoke tests)، وليست مصدراً مالياً بحد ذاتها. MCP يعرّف تبادل السياق والأدوات عبر JSON-RPC بين host/client/server. [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25) · [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)
3. **مكتبات Python:** لا تُشحن إلى Cloudflare Worker. يمكن استخدامها لاحقاً في ETL أو backtest منفصل فقط؛ أما Worker فيستعمل adapters TypeScript الموجودة لتقليل زمن البدء وحجم الحزمة.

## مصفوفة المطابقة

| المجال | الأداة/المصدر | الاستخدام داخل المشروع | الحالة والحدود |
|---|---|---|---|
| fundamentals وfilings | SEC `data.sec.gov` (submissions/companyfacts/frames) | `lib/bulk.ts` و`lib/providers.ts`، مع US-GAAP وIFRS وsnapshot احتياطي | مدمج؛ يجب احترام User-Agent وسياسة fair access، ولا يغطي custom taxonomies بالكامل |
| الأسعار التاريخية | Nasdaq history + Yahoo chart fallback | `lib/providers.ts` و`app/price-chart.tsx` | مدمج؛ التغطية/التأخير يختلفان حسب الرمز والمصدر |
| الأخبار | Yahoo RSS | بطاقة الأخبار في ملف الشركة | مدمج؛ مصدر ثانوي، لا يُستخدم وحده لاتخاذ قرار PASS |
| Form 4 | SEC submissions/filings | استخراج معاملات insider ذات code P | مدمج؛ لا يعني غياب الإيداع غياب insider activity |
| MCP الرسمي | `modelcontextprotocol/quickstart-resources` | مرجع لبناء smoke-test/diagnostic server عند الحاجة | مرجع تعليمي صغير، وليس financial provider. [GitHub](https://github.com/modelcontextprotocol/quickstart-resources) |
| SEC Python wrapper | `jadchaar/sec-edgar-api` | مرجع لفهم pagination/rate limiting في أدوات ETL الخارجية | غير مدمج في Worker؛ مكتبة Python غير رسمية، رغم دعمها pagination و10 طلبات/ثانية. [GitHub](https://github.com/jadchaar/sec-edgar-api) |
| Nasdaq Data Link | APIs/SDKs | خيار مزود مستقل مستقبلي للأسعار/السلاسل المرخصة | يحتاج حساب/مفتاح وشروط استخدام؛ لا يُفعل افتراضياً. [Docs](https://docs.data.nasdaq.com/) |
| موصلات مالية اختيارية | Alpaca، Financial Datasets، LONA Trading Assistant، TradingCursor، Stocktwits، IBKR/Longbridge | enrichment أو مقارنة مزودين بعد تفعيل المستخدم للمكوّن والاعتمادات | غير مثبتة في هذه البيئة؛ لا يجوز جعل الفحص يعتمد عليها قبل تحديد الترخيص، الحدود، provenance، وخطة fallback |
| مهارات العمل | Sites building/hosting، control-browser، deep-research | البناء والنشر والبحث وQA | مستخدمة في دورة التطوير؛ لا تُحمّل داخل التطبيق |

## ما الذي تم استعماله فعلياً

- تم توحيد بوابة التقييم في `lib/engine.ts`: لا يتحول نقص البيانات إلى PASS، والنتيجة تعرض الدرجة والتغطية والعوامل.
- تم تحسين bulk SEC وإضافة بدائل IFRS وfallback snapshot، مع تفضيل نتيجة **full** على quick في `lib/storage.ts`.
- تم إبقاء المصدر والتوقيت ودرجة الثقة ظاهرين في ملف الشركة بدلاً من إخفاء مصدر الرقم.
- تم فصل PASS/FAIL عن حالة «بيانات ناقصة» حتى لا تُعرض الشركات غير القابلة للحكم كأنها مرفوضة أو مؤهلة.

## بوابات الدمج قبل أي مصدر جديد

لا يُضاف مزود جديد إلى قرار التصنيف إلا بعد:

1. اختبار تطابق الرمز والفترة والوحدة بين مصدرين.
2. حفظ provenance (المصدر، وقت الالتقاط، الرابط، confidence) لكل حقل.
3. اختبارات انقطاع/تحديد معدل الطلبات وfallback حتمي.
4. قياس زمن full scan وحجم البيانات قبل وبعد الدمج.
5. اختبار محفظة holdout تشمل الشركات المشطوبة لتقليل survivorship bias.

## الفجوات التي تبقى صريحة

تحتاج الخطة الكاملة، قبل ادعاء التكافؤ مع النظام القديم، إلى بيانات delisted تاريخية، مزود مستقل ثانٍ مرخّص، backtests وholdouts قابلة لإعادة التشغيل، custom taxonomy/split adjustment، cache للترجمة العربية، وإتاحة مستودع GitHub فعلي إذا أصبح connector إنشاء المستودعات متاحاً. هذه ليست فجوات يمكن حلها بأمان بإضافة SDK عشوائي أو MCP داخل Worker.

