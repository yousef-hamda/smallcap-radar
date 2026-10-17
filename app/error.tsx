'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main dir="rtl" style={{ minHeight: '100vh', background: '#09090b', color: '#f4f4f5', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Tahoma, Arial, sans-serif' }}>
    <section role="alert" style={{ width: 'min(100%, 520px)', border: '1px solid #4b2730', borderRadius: 16, background: '#1c1014', padding: 28, lineHeight: 1.8 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>تعذّر عرض الصفحة</h1>
      <p style={{ color: '#e4b2bc', margin: '0 0 20px' }}>حدث خطأ أثناء عرض البيانات. يمكنك المحاولة مجددًا دون فقدان محفظتك المحفوظة.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={reset} style={{ border: 0, borderRadius: 10, background: '#00bc8b', color: '#04130d', padding: '10px 16px', font: 'inherit' }}>إعادة المحاولة</button>
        <button onClick={() => window.location.reload()} style={{ border: '1px solid #5c4249', borderRadius: 10, background: 'transparent', color: '#f4f4f5', padding: '10px 16px', font: 'inherit' }}>إعادة تحميل الصفحة</button>
      </div>
    </section>
  </main>;
}
