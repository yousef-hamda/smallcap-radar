import type {OpportunityEvaluation} from '@/lib/opportunity-engine';
import {money,price,percent,day} from './radar-format';

export default function OpportunityThesis({evaluation}:{evaluation:OpportunityEvaluation}) {
 const thesis=evaluation.thesis;if(!thesis)return null;
 const names={bear:'محافظ',base:'أساسي',bull:'متفائل'};
 return <section className="detail-box opportunity-thesis" aria-label="فرضية الفرصة الاستثمارية">
  <h3>فرضية الفرصة · {thesis.horizonMonths} أشهر</h3>
  <p>{thesis.action==='risk-review'?'مخاطر التمويل تحتاج مراجعة قبل قرار الشراء.':thesis.action==='candidate-review'?'مرشح لمراجعة استثمارية؛ تحقّق من المحفزات وشروط التمويل.':'البحث غير مكتمل لاتخاذ قرار شراء؛ الدرجة النهائية تظل مستخدمة في الترتيب.'}</p>
  <h4>القيمة الجوهرية وحساسية الافتراضات</h4>
  {thesis.valuation.status==='available'?<>
   <p>تقدير رياضي من التدفق النقدي بعد الإنفاق الرأسمالي وتعويضات الأسهم، مع مقارنة بصافي الدخل المعتاد. يُستخدم الأقل بين الطريقتين. الافتراضات ثابتة لجميع الشركات، وليست حقائق أعلنتها الشركة.</p>
   <div className="overflow-x-auto"><table><thead><tr><th>السيناريو</th><th>القيمة</th><th>الصعود إلى القيمة</th><th>الخصم عن القيمة</th><th>العائد المطلوب</th></tr></thead><tbody>{thesis.valuation.scenarios.map(item=><tr key={item.name}><td>{names[item.name]}</td><td dir="ltr">{price(item.valuePerSecurity)}</td><td dir="ltr">{percent(item.upside)}</td><td dir="ltr">{percent(item.discount)}</td><td dir="ltr">{percent(item.requiredReturn)}</td></tr>)}</tbody></table></div>
   <p>التدفق المعتاد: ${money(thesis.valuation.normalizedCashflow)} · صافي الدخل المعتاد: ${money(thesis.valuation.normalizedEarnings)}. لا يمثل تقدير القيمة هدفًا لسعر السهم خلال ستة أشهر؛ مراجعة الأسهم المخففة والمطالبات ذات الأولوية لازمة.</p>
  </>:<p>لا تتوفر مدخلات متطابقة وكافية لنموذج القيمة الجوهرية المناسب. لا يُستبدل هذا النقص بهدف محلل أو تقدير إيجابي افتراضي.</p>}
  <h4>التمويل والتخفيف</h4><p>النقد: {thesis.funding.cash==null?'غير موثق':`${money(thesis.funding.cash)} ${thesis.funding.cashCurrency??"عملة غير موثقة"}`} · الدين: {thesis.funding.debt==null?'غير موثق':`${money(thesis.funding.debt)} ${thesis.funding.debtCurrency??"عملة غير موثقة"}`} · التخفيف المعدّل للتجزئة: {thesis.funding.dilution==null?'غير موثق':percent(thesis.funding.dilution)}</p>
  {thesis.funding.cashRunwayMonths!=null&&<p>مدة التمويل وفق معدل التدفق النقدي التاريخي: {thesis.funding.cashRunwayMonths.toFixed(1)} شهر؛ ليست توقعًا مضمونًا للسيولة.</p>}
  <h4>المواعيد الواردة في الإفصاحات</h4>
  {thesis.catalysts.length?<ul>{thesis.catalysts.map(item=><li key={item.id}><a href={item.source} target="_blank" rel="noreferrer">{day(item.date)} · نص الإفصاح ↗</a><p dir="ltr">{item.title}</p><small>يحتاج مراجعة الأثر والإلزامية والتمويل؛ لم تُمنح نقاط إيجابية لمجرد ورود موعد.</small></li>)}</ul>:<p>لا يوجد محفز مؤرخ ومراجع في البيانات الحالية. غياب الاستخراج لا يثبت غياب أحداث الشركة.</p>}
  <h4>شروط إبطال الفرضية</h4><p>تُراجع الفرضية إذا تراجع التدفق النقدي المعتاد، أو لم يعد التمويل يغطي فترة البحث، أو ظهر تخفيف أو تعارض في الإفصاحات. لا توجد نسبة احتمال صعود معتمدة تجريبيًا.</p>
  {!!thesis.valuation.gaps.length&&<details><summary>نواقص التحقق · {thesis.valuation.gaps.length}</summary>{thesis.valuation.gaps.map(gap=><p key={gap} dir="ltr">{gap}</p>)}</details>}
 </section>;
}
