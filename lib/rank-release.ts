/** Bound public release identities before using them in cache keys or queries. */
export function requestedRankRelease(params: URLSearchParams) {
  const runId = params.get('runId') || undefined;
  const releaseToken = params.get('release') || undefined;
  if ((runId && !/^[A-Za-z0-9_-]{1,100}$/.test(runId))
    || (releaseToken && (!runId || releaseToken.length > 160 || !releaseToken.startsWith(`${runId}:`) || !/^[A-Za-z0-9_:-]+$/.test(releaseToken)))) {
    throw Object.assign(new Error('معرّف إصدار الترتيب غير صالح'), {status:400});
  }
  return {runId,releaseToken};
}
