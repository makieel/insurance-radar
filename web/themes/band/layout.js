// 띠 배치 계산(순수 함수, DOM 없음). 날짜는 KST YYYY-MM-DD 문자열이고 UTC 자정으로 계산한다.
export const RANGES = { 1: 31, 3: 92, 6: 183 };
export const LANE_KEYS = ['auto', 'medical', 'life', 'general'];

const DAY = 86400000;
export const ut = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => iso(ut(s) + n * DAY);

export function bandWindow(today, months) {
  const days = RANGES[months];
  return { start: addDays(today, -days), end: addDays(today, days) };
}

const fracOf = (t, win) => (t - ut(win.start)) / (ut(win.end) - ut(win.start));

export function placeExact(changes, win) {
  return changes
    .filter((c) => c.when === 'exact' && c.date && c.date >= win.start && c.date <= win.end)
    .map((change) => ({ change, x: fracOf(ut(change.date), win) }))
    .sort((a, b) => a.x - b.x);
}

/** 기간 막대. x1은 끝 날짜 하루를 포함한 위치다. */
export function placePeriods(changes, win) {
  return changes
    .filter((c) => c.when === 'period' && c.period && c.period.end >= win.start && c.period.start <= win.end)
    .map((change) => {
      const { start, end } = change.period;
      return {
        change,
        x0: Math.max(0, fracOf(ut(start), win)),
        x1: Math.min(1, fracOf(ut(end) + DAY, win)),
        clippedStart: start < win.start,
        clippedEnd: end > win.end,
      };
    })
    .sort((a, b) => a.x0 - b.x0 || a.change.period.end.localeCompare(b.change.period.end));
}

/** 띠 범위 밖 exact·period 개수. phrase는 띠에 그리지 않으므로 세지 않는다. */
export function outOfRange(changes, win) {
  let before = 0;
  let after = 0;
  for (const c of changes) {
    const s = c.when === 'exact' ? c.date : c.when === 'period' ? c.period?.start : null;
    const e = c.when === 'exact' ? c.date : c.when === 'period' ? c.period?.end : null;
    if (!s || !e) continue;
    if (e < win.start) before++;
    else if (s > win.end) after++;
  }
  return { before, after };
}

/** x 순으로 이웃과의 간격이 minGap보다 좁으면 한 묶음. 묶음 x는 첫 점과 끝 점의 가운데. */
export function clusterPoints(points, minGap) {
  const out = [];
  for (const p of [...points].sort((a, b) => a.x - b.x)) {
    const g = out[out.length - 1];
    if (g && p.x - g.last < minGap) {
      g.items.push(p);
      g.last = p.x;
    } else {
      out.push({ first: p.x, last: p.x, items: [p] });
    }
  }
  return out.map((g) => ({ x: (g.first + g.last) / 2, items: g.items }));
}

/**
 * x 오름차순 점에 날짜 글자 줄(0~2)을 준다. 바로 앞에 보인 점과 minGap보다 가까우면 그 다음 줄로,
 * 그 줄에서도 앞 글자와 minGap보다 가까우면 더 아래 줄로 내린다. 세 줄로도 모자라면 row -1(글자 숨김).
 */
export function labelRows(points, minGap) {
  const last = [-Infinity, -Infinity, -Infinity];
  let prev = null;
  return points.map((p) => {
    let row = prev && p.x - prev.x < minGap ? prev.row + 1 : 0;
    while (row < last.length && p.x - last[row] < minGap) row++;
    if (row >= last.length) return { ...p, row: -1 };
    last[row] = p.x;
    prev = { x: p.x, row };
    return { ...p, row };
  });
}

export function isRecent(c, today) {
  if (c.when === 'exact') return !!c.date && c.date <= today;
  return c.when === 'phrase' && c.past === true;
}

const recentKey = (c) => c.date ?? c.announced ?? '';
// 예정은 가까운 것부터, 날짜를 말하지 않은 phrase는 뒤로
const upcomingKey = (c) => c.date ?? c.period?.start ?? '9999-99-99';

export function lanes(changes, today) {
  const out = Object.fromEntries(LANE_KEYS.map((k) => [k, { recent: [], upcoming: [] }]));
  for (const c of changes) {
    const lane = out[c.category];
    if (!lane) continue;
    (isRecent(c, today) ? lane.recent : lane.upcoming).push(c);
  }
  for (const k of LANE_KEYS) {
    out[k].recent.sort((a, b) => recentKey(b).localeCompare(recentKey(a)));
    out[k].upcoming.sort((a, b) => upcomingKey(a).localeCompare(upcomingKey(b)));
  }
  return out;
}
