const MOBILE_UA_RE = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i;

export function isMobileUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return MOBILE_UA_RE.test(ua);
}
