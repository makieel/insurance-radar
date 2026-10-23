// 화면용 서식 함수 모음. 테마는 ctx.fmt로 받아 쓴다.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function count(n) {
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 100000) return `${(n / 1000).toFixed(1)}K`;
  return `${Math.round(n / 1000)}K`;
}

export function signed(n) {
  if (n > 0) return `+${n.toLocaleString('en-US')}`;
  if (n < 0) return `-${Math.abs(n).toLocaleString('en-US')}`;
  return '0';
}

export function ago(iso, now = new Date()) {
  const diff = new Date(now).getTime() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '어제' : `${days}일 전`;
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function kstStamp(iso) {
  const k = new Date(new Date(iso).getTime() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${DOW[k.getUTCDay()]} · ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST`;
}

export function koOr(ko, orig) {
  return ko ? ko : orig;
}

/** 절대 http/https URL만 통과시키고 나머지는 '#'. 모든 href에 쓴다. */
export function safeUrl(u) {
  if (typeof u !== 'string') return '#';
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:' ? u : '#';
  } catch {
    return '#';
  }
}
