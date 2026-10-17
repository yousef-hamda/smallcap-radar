'use client';

import ErrorPage from './error';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="ar" dir="rtl"><body style={{ margin: 0 }}><ErrorPage error={error} reset={reset} /></body></html>;
}
