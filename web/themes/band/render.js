// 띠 테마 그리기: 확정 시안 design/v5/mobile.html의 마크업과 동작을 latest.json 데이터로 옮겼다.
// 데스크톱은 v4-2와 같고, 767px 이하에서만 모바일 구성(압축 띠·하단 시트·아코디언·하단 탭)이 된다.
import { esc, safeUrl } from '../../core/format.js';
import { RANGES, LANE_KEYS, bandWindow, placeExact, placePeriods, outOfRange, clusterPoints, labelRows, lanes, ut, iso } from './layout.js';

const LABEL = { auto: '자동차', medical: '실손', life: '생명·건강·상해', general: '제도·공통' };
const CK = { auto: 'car', medical: 'med', life: 'life', general: 'ind' };
// config.json의 출처 이름과 같게 둔다(latest.json에는 출처 id만 있다)
const SOURCE_NAME = {
  'fsc-press': '금융위원회', 'fsc-rule': '금융위원회 입법·규정변경예고', 'fss-press': '금융감독원', 'fss-alert': '금융감독원 소비자경보',
  'knia-press': '손해보험협회', 'knia-rates': '손보협회 공시실', 'klia-press': '생명보험협회', kiri: '보험연구원',
  hanwha: '한화생명', kyobo: '교보생명', samsungfire: '삼성화재', meritz: '메리츠화재',
  insnews: '한국보험신문', insweek: '보험신보', insjournal: '보험저널', fins: '보험매일', naver: '네이버 뉴스',
};
const DISCLAIMER = '이 사이트는 공개된 보도자료와 기사를 자동으로 모아 보여 주는 정보 제공용이며, 보험 가입이나 해지를 권유하지 않습니다. 요약은 AI가 만들었으므로 정확한 내용은 반드시 원문과 약관에서 확인하세요.';
const NO_CHANGES = '아직 모은 변경 항목이 없습니다';
const NONE = '없습니다';
const DEFAULT_INFO = '점·점선 막대·보험료 표시에 마우스를 올리면 여기에 내용이 나오고, 누르면 고정되며 아래 표에서도 강조됩니다.';
const RANGE_KEYS = Object.keys(RANGES).map(Number);
const MINW = { 1: 520, 3: 640, 6: 760 };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const SNAME = { up: '인상', dn: '인하', zero: '변동 없음' };
const PROP = '<span class="prop">예고 · 확정 아님</span>';
const DAY = 86400000;

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const arr = (v) => (Array.isArray(v) ? v : []);
const cc = (k) => 'c-' + (CK[k] || 'ind');
const sgn = (t) => (t > 0 ? 'up' : t < 0 ? 'dn' : 'zero');
const pct = (t) => (t > 0 ? `+${t}` : `${t}`);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const uniq = (xs) => [...new Set(xs)];
// 글자 폭 어림(한글 11px, 그 밖 6.6px)
const tw = (s) => [...String(s)].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 11 : 6.6), 0);
// 겹치지 않게 줄(레벨) 나누기
const levels = (xs, max) => {
  const ends = Array(max).fill(-1e9);
  return xs.map(({ x, w }) => {
    let l = ends.findIndex((e) => x - w / 2 >= e + 3);
    if (l < 0) l = ends.indexOf(Math.min(...ends));
    ends[l] = x + w / 2;
    return l;
  });
};
const link = (title, url, tip) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener"${tip ? ` title="${esc(tip)}"` : ''}>${esc(title)}</a>`;
const srcLinks = (srcs) => srcs.map((s) => link(s.name, s.url)).join(' · ');

const validChange = (c) => {
  if (!c || !LABEL[c.category] || typeof c.title !== 'string') return false;
  if (c.when === 'exact') return isIso(c.date);
  if (c.when === 'period') return !!c.period && isIso(c.period.start) && isIso(c.period.end);
  return c.when === 'phrase' && typeof c.phrase === 'string';
};
const validGroup = (g) => g && typeof g.title === 'string';

export function render(root, data, ctx) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  // 다시 그릴 때 이전 이벤트를 모두 뗀다
  root._irAbort?.abort();
  const ac = new AbortController();
  root._irAbort = ac;
  const on = { signal: ac.signal };
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  const d0 = data && typeof data === 'object' ? data : {};
  const TODAY = isIso(d0.date) ? d0.date : iso(Date.now() + 9 * 3600000);
  const CHANGES = arr(d0.changes).filter(validChange);
  const NEWS = arr(d0.news).filter(validGroup);
  const OFFICIAL = arr(d0.official).filter(validGroup);
  const INDUSTRY = arr(d0.industry).filter(validGroup);
  const RATES = arr(d0.rates).filter((r) => r && isIso(r.effective) && Number.isFinite(r.total));
  const STATUS = arr(d0.status).filter((s) => s && typeof s.source === 'string');
  const counts = d0.counts && typeof d0.counts === 'object' ? d0.counts : {};

  // ── 날짜 도우미 ──
  const md = (d) => { const [, m, dd] = d.split('-'); return `${+m}.${+dd}`; };
  const mdY = (d) => (d.slice(0, 4) === TODAY.slice(0, 4) ? md(d) : `'${d.slice(2, 4)}.${md(d)}`);
  const fmtD = (d) => `${d.slice(0, 4)}.${md(d)}`;
  const dayDiff = (d) => Math.round((ut(TODAY) - ut(d)) / DAY);
  const dLabel = (d) => { const n = dayDiff(d); return n > 0 ? `D+${n}` : n === 0 ? 'D-DAY' : `D${n}`; };
  const dTxt = (d) => { const n = dayDiff(d); return n > 0 ? `${n}일 지남` : n === 0 ? '오늘' : `${-n}일 남음`; };
  const stampOf = (s) => {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return fmtD(TODAY);
    const k = new Date(t + 9 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}.${k.getUTCMonth() + 1}.${k.getUTCDate()} (${DOW[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  };
  // 원문 기간을 사람이 읽는 말로(그린 범위 설명용)
  const periodSay = (p) => {
    const [sy, sm, sd] = p.start.split('-').map(Number);
    const [ey, em, ed] = p.end.split('-').map(Number);
    if (sy === ey && sd === 1 && ed === lastDay(ey, em)) {
      if (sm === em) return `${sy}년 ${sm}월 한 달`;
      if (sm === 1 && em === 12) return `${sy}년 한 해`;
      return `${sy}년 ${sm}~${em}월`;
    }
    return `${fmtD(p.start)}부터 ${ey}년 ${em}월 ${ed}일까지`;
  };

  // ── 변경 항목 도우미 ──
  const idx = (c) => CHANGES.indexOf(c);
  const fuzzy = CHANGES.filter((c) => c.when !== 'exact');
  const BANDED = CHANGES.filter((c) => c.when === 'period');
  const LOOSE = CHANGES.filter((c) => c.when === 'phrase');
  const srcsOf = (c) => arr(c.sources).filter((s) => s && typeof s.name === 'string');
  const srcLabel = (c) => { const s = srcsOf(c); return s.length ? s[0].name + (s.length > 1 ? ` 외 ${s.length - 1}곳` : '') : ''; };
  const chLink = (c) => link(c.title, srcsOf(c)[0]?.url, c.title);
  const propOf = (c) => (c.status === 'proposed' ? PROP : '');
  const pubTxt = (c) => (isIso(c.announced) ? ` ${mdY(c.announced)} 발표` : '');
  const clip = (q, p, n = 44) => {
    if (q.length <= n) return q;
    const i = p ? Math.max(0, q.indexOf(p)) : 0;
    const s = Math.max(0, Math.min(i - 8, q.length - n));
    return (s > 0 ? '…' : '') + q.slice(s, s + n) + (s + n < q.length ? '…' : '');
  };
  const rawOf = (c) => {
    if (c.origin === 'rates') return `공시표 ${c.phrase}`;
    if (c.when === 'exact' || !c.quote) return `원문 "${c.phrase}"`;
    return `원문 "${clip(c.quote, c.phrase)}"`;
  };
  // 공시표 변경은 같은 행의 조정 사유를 덧붙인다
  const noteOf = (c) => {
    if (!c.rate) return null;
    const r = RATES.find((x) => x.company === c.rate.company && x.kind === c.rate.kind && x.effective === c.date);
    return r?.reason || null;
  };

  // ── 보험료 조정: 같은 시행일끼리 묶음 ──
  const rateGroup = (rs) => {
    const ss = uniq(rs.map((r) => sgn(r.total)));
    const vs = uniq(rs.map((r) => pct(r.total)));
    return { date: rs[0].effective, rs, s: ss.length === 1 ? ss[0] : 'zero', label: vs.map((v) => v + '%').join('/') + (rs.length > 1 ? ` ×${rs.length}` : '') };
  };
  const RG = [...RATES.reduce((m, r) => m.set(r.effective, [...(m.get(r.effective) || []), r]), new Map()).values()].map(rateGroup);
  const rateMerge = (gs) => rateGroup(gs.flatMap((g) => g.rs));

  // ── 상태 ──
  const MQ = win.matchMedia('(max-width: 767px)');
  const isM = () => MQ.matches;
  const defRange = () => (isM() ? 1 : 3);
  const st = { range: defRange(), rates: false, filter: 'all', pin: null, userRange: false, open: null };
  const curWin = () => bandWindow(TODAY, st.range);
  const inWin = (d, w) => d >= w.start && d <= w.end;
  const shown = (c) => c.when !== 'exact' || inWin(c.date, curWin());
  const smooth = () => (win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  // ── 1단계: 띠 ──
  let lastW = 0;
  const renderStrip = (recenter) => {
    const w = curWin(), ax = $('#axbox'), M = isM();
    // 모바일은 가로 스크롤 없이 화면 폭에 맞춘다
    const W = M ? Math.max(ax.clientWidth - 24, 200) : Math.max(ax.clientWidth - 36, MINW[st.range]);
    lastW = ax.clientWidth;
    const t0 = ut(w.start), t1 = ut(w.end);
    const X = (d) => ((ut(d) - t0) / (t1 - t0)) * W;
    const xT = X(TODAY);
    const nextR = RANGE_KEYS.find((r) => r > st.range);

    let y = 26; const R = {};
    if (st.rates) { R.rate = y; y += M ? 44 : 38; }
    R.dotTop = y; R.base = y + 38; y += M ? 58 : 52;

    // 점선 막대(원문 기간)
    const bs = placePeriods(CHANGES, w).map((p) => ({ c: p.change, p: p.change.period, x1: p.x0 * W, x2: p.x1 * W, cutL: p.clippedStart, cutR: p.clippedEnd }));
    const rowEnd = [];
    bs.forEach((b) => {
      let r = rowEnd.findIndex((e) => b.x1 >= e - 0.5);
      if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
      b.row = r; b.prev = rowEnd[r]; rowEnd[r] = b.x2;
    });
    const nRows = Math.max(1, rowEnd.length);
    const BROW = M ? 44 : 22; // 모바일은 막대 한 줄을 누르기 좋은 44px로
    if (M) { R.band = y; y += nRows * BROW; } else { R.band = y + 2; y += 2 + nRows * 22; }
    const H = y + (M ? 22 : 24);

    // 범위 밖 개수
    const oor = outOfRange(CHANGES, w);
    const exB = CHANGES.filter((c) => c.when === 'exact' && c.date < w.start);
    const exA = CHANGES.filter((c) => c.when === 'exact' && c.date > w.end);
    const pdB = BANDED.filter((c) => c.period.end < w.start);
    const pdA = BANDED.filter((c) => c.period.start > w.end);
    const rtB = st.rates ? RATES.filter((r) => r.effective < w.start) : [];
    const rtA = st.rates ? RATES.filter((r) => r.effective > w.end) : [];
    const nL = oor.before + rtB.length, nR = oor.after + rtA.length;
    const parts = (ex, pd, rt) => [
      ex.length ? `시행일 ${ex.length}건(${ex.map((c) => mdY(c.date)).join(', ')})` : '',
      pd.length ? `기간 ${pd.length}건(${pd.map((c) => c.phrase).join(', ')})` : '',
      rt.length ? `보험료 ${rt.length}건(${uniq(rt.map((r) => mdY(r.effective))).join(', ')})` : '',
    ].filter(Boolean).join(' · ');
    let noteL = '', noteR = '';
    if (nL) {
      const pl = parts(exB, pdB, rtB);
      noteL = nextR
        ? `<button type="button" class="oor" data-r="${nextR}" title="${esc('범위 밖: ' + pl + ' · 누르면 ±' + nextR + '개월로 넓힘')}">이전 ${nL}건 더 보기</button>`
        : `<span class="oor" title="${esc('±6개월보다 앞: ' + pl + ' · 아래 표에 있음')}">· 범위 밖 ${esc(pl)}</span>`;
    }
    if (nR) {
      const pr = parts(exA, pdA, rtA);
      noteR = nextR
        ? `<button type="button" class="oor" data-r="${nextR}" title="${esc('범위 밖: ' + pr + ' · 누르면 ±' + nextR + '개월로 넓힘')}">이후 ${nR}건 더 보기</button>`
        : `<span class="oor" title="${esc('±6개월보다 뒤: ' + pr)}">범위 밖 ${nR}건 ·</span>`;
    }
    // 모바일: 범위 밖 안내는 띠 아래 한 줄(누르기 좋은 크기)로
    let mOor = '';
    if (M) {
      const lp = [...exB.map((c) => mdY(c.date)), ...pdB.map((c) => c.phrase), ...uniq(rtB.map((r) => mdY(r.effective)))];
      const rp = [...exA.map((c) => mdY(c.date)), ...pdA.map((c) => c.phrase), ...uniq(rtA.map((r) => mdY(r.effective)))];
      if (nL) mOor += nextR ? `<button type="button" class="mo-r" data-r="${nextR}" aria-label="${esc(`범위 밖 이전 ${nL}건 · ±${nextR}개월로 넓혀 보기`)}">◀ 이전 ${nL}건 (${esc(lp.join('·'))}) 더 보기</button>` : `<span>◀ 범위 밖 ${nL}건 · 아래 목록에 있음</span>`;
      if (nR) mOor += nextR ? `<button type="button" class="mo-r r" data-r="${nextR}" aria-label="${esc(`범위 밖 이후 ${nR}건(${rp.join(', ')}) · ±${nextR}개월로 넓혀 보기`)}">이후 ${nR}건 더 보기 ▶</button>` : `<span class="r">범위 밖 ${nR}건 ▶</span>`;
    }
    $('#mOor').innerHTML = mOor;

    // 월 격자
    let grid = '';
    const [sy, sm] = w.start.split('-').map(Number);
    for (let k = 1; k <= 14; k++) {
      const d = iso(Date.UTC(sy, sm - 1 + k, 1));
      if (d > w.end) break;
      const x = X(d), mo = +d.slice(5, 7);
      grid += `<div class="gl" style="left:${x.toFixed(1)}px;top:${R.rate ?? R.dotTop}px"></div><span class="gm" style="left:${x.toFixed(1)}px">${mo}월${mo === 1 ? `<i>${d.slice(0, 4)}</i>` : ''}</span>`;
    }

    // 시행일 점
    const dots = placeExact(CHANGES, w).map((p) => ({ c: p.change, x: p.x * W }));
    let dotHtml;
    if (M) {
      // 모바일: 44px 안에 겹치는 점은 하나의 묶음 점(건수 표시)으로 합친다
      const gs = clusterPoints(dots, 44);
      const lab = (g) => (g.items.length === 1 ? md(g.items[0].c.date) : `${md(g.items[0].c.date)}~${md(g.items[g.items.length - 1].c.date)}`);
      const glv = levels(gs.map((g) => ({ x: g.x, w: tw(lab(g)) * 1.05 + 6 })), 2);
      dotHtml = gs.map((g, i) => {
        const cs = g.items.map((o) => o.c), cats = uniq(cs.map((c) => c.category));
        const one = cs.length === 1;
        const k = one ? `d:${idx(cs[0])}` : `m:${cs.map(idx).join(',')}`;
        const al = one ? `${md(cs[0].date)} ${cs[0].title} · 눌러서 상세 보기` : `${lab(g)} 시행 ${cs.length}건 묶음 · 눌러서 상세 보기`;
        return `<button type="button" class="dot${one ? '' : ' grp'} ${cats.length === 1 ? cc(cats[0]) : ''}${glv[i] ? ' lv1' : ''}" data-k="${k}" data-i="${cs.map(idx).join(',')}"${cats.length === 1 ? ` data-cat="${cats[0]}"` : ''}${one ? '' : ` data-n="${cs.length}"`} style="left:${g.x.toFixed(1)}px;top:${R.base + 1}px" aria-label="${esc(al)}"><span class="dl">${lab(g)}</span></button>`;
      }).join('');
    } else {
      // 날짜 글자 줄: 0 = 점 위, 1 = 그 위, 2 = 점 아래, -1 = 글자 숨김(안내 줄에서 확인)
      const rows = labelRows(placeExact(CHANGES, w), 34 / W);
      dotHtml = rows.map(({ change: c, x, row }) => `<button type="button" class="dot ${cc(c.category)}${row > 0 ? ` lv${row}` : ''}" data-k="d:${idx(c)}" data-i="${idx(c)}" data-cat="${c.category}" style="left:${(x * W).toFixed(1)}px;top:${R.base + 1}px" aria-label="${esc(md(c.date) + ' ' + c.title)}">${row < 0 ? '' : `<span class="dl">${md(c.date)}</span>`}</button>`).join('');
    }
    const noFut = dots.some((d) => d.c.date > TODAY) ? '' : `<span class="nofut" style="left:${(xT + 10).toFixed(1)}px;top:${R.base}px">${M ? '확정된 예정 없음' : '날짜가 확정된 예정 항목 없음'}</span>`;

    // 막대
    const bandHtml = M ? bs.map((b) => {
      // 모바일: 보이는 막대는 22px, 누르는 칸은 높이 44px·폭 최소 44px
      const top = R.band + b.row * BROW, wpx = Math.max(6, b.x2 - b.x1 - 2), pad = Math.max(0, (44 - wpx) / 2);
      const txt = b.c.phrase + (b.cutR ? ' ▸' : '');
      const fits = tw(txt) * 1.05 + 14 <= wpx;
      const title = `${b.c.phrase} = ${periodSay(b.p)} (원문 기간, 정확한 날짜 아님)`;
      return `<button type="button" class="mband ${cc(b.c.category)}${b.cutR ? ' cut-r' : ''}${b.cutL ? ' cut-l' : ''}" data-k="b:${idx(b.c)}" data-i="${idx(b.c)}" data-cat="${b.c.category}" style="left:${(b.x1 - pad).toFixed(1)}px;width:${(wpx + pad * 2).toFixed(1)}px;top:${top}px" aria-label="${esc(title + ' · ' + b.c.title + ' · 눌러서 상세 보기')}"><span style="left:${pad.toFixed(1)}px;width:${wpx.toFixed(1)}px">${fits ? esc(txt) : ''}</span></button>`;
    }).join('') : bs.map((b) => {
      const top = R.band + b.row * 22, wpx = Math.max(6, b.x2 - b.x1 - 2);
      const txt = b.c.phrase + (b.cutR ? ' ▸' : '');
      const fits = tw(txt) + 14 <= wpx;
      const outside = !fits && b.x1 - b.prev >= tw(b.c.phrase) + 8;
      const common = `data-k="b:${idx(b.c)}" data-i="${idx(b.c)}" data-cat="${b.c.category}"`;
      const title = `${b.c.phrase} = ${periodSay(b.p)} (원문 기간, 정확한 날짜 아님)`;
      return `<button type="button" class="band ${cc(b.c.category)}${b.cutR ? ' cut-r' : ''}${b.cutL ? ' cut-l' : ''}" ${common} style="left:${b.x1.toFixed(1)}px;width:${wpx.toFixed(1)}px;top:${top}px" title="${esc(title)}" aria-label="${esc(title + ' · ' + b.c.title)}">${outside ? '' : esc(txt)}</button>`
        + (outside ? `<span class="blab ${cc(b.c.category)}" ${common} style="right:${(W - b.x1 + 4).toFixed(1)}px;top:${top}px">${esc(b.c.phrase)}</span>` : '');
    }).join('');

    // 보험료 줄
    let rateHtml = '';
    const noRateFut = RG.some((g) => g.date > TODAY) ? '' : null;
    if (st.rates && M) {
      // 모바일: 겹치는 보험료 표시는 하나로 묶고 한 줄로만 놓는다
      const gs0 = RG.filter((g) => inWin(g.date, w)).map((g) => ({ g, x: X(g.date) }));
      rateHtml = clusterPoints(gs0, 64).map((q) => {
        const one = q.items.length === 1;
        const g = one ? q.items[0].g : rateMerge(q.items.map((o) => o.g));
        const k = one ? `r:${g.date}` : `q:${q.items.map((o) => o.g.date).join(',')}`;
        const when = one ? md(g.date) : `${md(q.items[0].g.date)}~${md(q.items[q.items.length - 1].g.date)}`;
        return `<button type="button" class="rp ${g.s}" data-k="${k}" data-cat="auto" style="left:${q.x.toFixed(1)}px;top:${R.rate + 12}px" aria-label="${esc(when + ' 자동차보험료 ' + g.label + ' · 눌러서 상세 보기')}">${esc(g.label)}</button>`;
      }).join('')
        + (noRateFut ?? `<span class="nofut" style="left:${(xT + 10).toFixed(1)}px;top:${R.rate + 22}px">예정 조정 없음</span>`)
        + `<div class="sep" style="top:${R.rate + 44}px"></div>`;
    } else if (st.rates) {
      const gs = RG.filter((g) => inWin(g.date, w)).map((g) => ({ g, x: X(g.date) })).sort((a, b) => a.x - b.x);
      const rlv = levels(gs.map((o) => ({ x: o.x, w: o.g.label.length * 6.6 + 12 })), 2);
      rateHtml = gs.map(({ g, x }, i) => `<button type="button" class="rp ${g.s}" data-k="r:${g.date}" data-cat="auto" style="left:${x.toFixed(1)}px;top:${R.rate + 1 + rlv[i] * 18}px" aria-label="${esc(md(g.date) + ' 자동차보험료 ' + g.label)}">${esc(g.label)}</button>`).join('')
        + (noRateFut ?? `<span class="nofut" style="left:${(xT + 10).toFixed(1)}px;top:${R.rate + 17}px">수집된 예정 조정 없음</span>`)
        + `<div class="sep" style="top:${R.rate + 36}px"></div>`;
    }

    const axis = $('#axis');
    axis.className = 'axis' + (st.range === 6 ? ' r6' : '');
    axis.style.width = W + 'px'; axis.style.height = H + 'px';
    axis.innerHTML = `<div class="fut" style="left:${xT.toFixed(1)}px"></div>${grid}
      <div class="base" style="top:${R.base}px"></div>
      ${M ? `<div class="cl l">◀ 지난 <span class="mono">${mdY(w.start)}~</span></div>
      <div class="cl r"><span class="mono">~${mdY(w.end)}</span> 예정 ▶</div>` : `<div class="cl l">◀ 지난 시행 <span class="mono">${mdY(w.start)}~</span>${noteL}</div>
      <div class="cl r">${noteR}<span class="mono">~${mdY(w.end)}</span> 예정 ▶</div>`}
      ${bandHtml}
      <div class="now" style="left:${xT.toFixed(1)}px"><span>오늘 ${md(TODAY)}</span></div>
      ${rateHtml}${noFut}${dotHtml}`;

    $('#rlab').innerHTML = (st.rates ? `<span style="top:${R.rate + 17}px">보험료</span>` : '')
      + `<span style="top:${R.base}px">시행일</span><span style="top:${R.band + nRows * 11}px">기간<br><i>원문</i></span>`;

    // 미확정 묶음
    $('#fzb').innerHTML = `<span class="fzt">미확정 ${fuzzy.length}건<small>점으로 찍지 않음</small></span>
      <span class="fzs">점선 막대로 표시 · 원문이 말한 기간</span>
      <span class="fzl">${BANDED.length ? BANDED.map((c) => { const out = c.period.start > w.end || c.period.end < w.start; return `<span class="bd ${cc(c.category)}" data-cat="${c.category}"><span class="catdot"></span>${esc(c.phrase)}${out ? ' <i>(범위 밖)</i>' : ''}</span>`; }).join('') : '<span>없음</span>'}</span>
      <span class="fzs">기간을 말하지 않음 · 막대 없음</span>
      <span class="fzl">${LOOSE.length ? LOOSE.map((c) => `<span class="${cc(c.category)}" data-cat="${c.category}"><span class="catdot"></span>${esc(c.phrase)}${c.past ? ' <i>(지난 일)</i>' : ''}</span>`).join('') : '<span>없음</span>'}</span>`;

    $('#period').textContent = M ? `${mdY(w.start)} ~ ${mdY(w.end)} · 오늘 기준 ±${st.range}개월` : `${mdY(w.start)} ~ ${mdY(w.end)} · 오늘을 가운데 두고 앞뒤 ±${st.range}개월`;
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.r === st.range)));
    $('#rateTg').setAttribute('aria-pressed', String(st.rates));
    $('#rateLg').classList.toggle('hide', !st.rates);
    $$('.row[data-rd]').forEach((r) => r.classList.toggle('inwin', st.rates && inWin(r.dataset.rd, w)));

    if (recenter && ax.scrollWidth > ax.clientWidth) ax.scrollLeft = 18 + xT - ax.clientWidth / 2;
  };

  // ── 고정 안내 줄 (말풍선 대신) ──
  const rateLine = (r) => `${esc(r.company)} ${esc(r.kind)} <span class="n mono ${sgn(r.total)}">${esc(pct(r.total))}%</span>`;
  const infoBody = (k) => {
    if (!k) return null;
    if (k === 'f') return `<b>미확정 ${fuzzy.length}건</b><span>원문에 정확한 날짜가 없어 점으로 찍지 않았습니다. 아래 표에서 점선 테두리로 강조했습니다.</span>`;
    const t = k.slice(0, 1), v = k.slice(2);
    if (t === 'd') {
      const c = CHANGES[+v];
      if (!c) return null;
      const note = noteOf(c);
      return `<span class="catdot ${cc(c.category)}"></span><b class="mono">${md(c.date)} · ${dLabel(c.date)}</b><span>${esc(LABEL[c.category])}</span><span class="t">${propOf(c)}${chLink(c)}</span><span class="m">${esc(rawOf(c))} · ${esc(srcLabel(c))}${note ? ' · ' + esc(note) : ''}</span>`;
    }
    if (t === 'b') {
      const c = CHANGES[+v];
      if (!c || c.when !== 'period') return null;
      return `<span class="ico-band ${cc(c.category)}" style="border-color:var(--c)"></span><b>${esc(c.phrase)}</b><span>= ${esc(periodSay(c.period))}로 그림 · 정확한 날짜 아님</span><span class="t">${propOf(c)}${chLink(c)}</span><span class="m">${esc(rawOf(c))} · ${esc(srcLabel(c))}${esc(pubTxt(c))}</span>`;
    }
    if (t === 'm') {
      const cs = v.split(',').map((i) => CHANGES[+i]).filter(Boolean);
      return cs.length ? `<b>시행일 ${cs.length}건 묶음</b><span>${cs.map((c) => esc(md(c.date) + ' ' + c.title)).join(' · ')}</span>` : null;
    }
    if (t === 'r' || t === 'q') {
      const gs = v.split(',').map((d) => RG.find((o) => o.date === d)).filter(Boolean);
      if (!gs.length) return null;
      const g = gs.length === 1 ? gs[0] : rateMerge(gs);
      return `<span class="ico-rp ${g.s}"></span><b class="mono">${md(g.date)} · ${dLabel(g.date)}</b><span>자동차보험료 ${SNAME[g.s]}</span><span class="t">${g.rs.map(rateLine).join(', ')}</span><span class="m">손보협회 공시실 · 공시표 시행시기 기준</span>`;
    }
    return null;
  };
  const showInfo = (k, preview) => {
    const el = $('#info'), body = infoBody(k);
    const pinned = !preview && body;
    el.classList.toggle('pin', !!pinned);
    el.innerHTML = body
      ? (pinned ? '<span class="k">선택</span>' : '') + body + (pinned ? '<button type="button" class="x">선택 해제</button>' : '')
      : `<span>${CHANGES.length ? DEFAULT_INFO : NO_CHANGES}</span>`;
  };

  // ── 2단계: 레인 표 ──
  const laneSets = () => {
    const L = lanes(CHANGES, TODAY);
    return LANE_KEYS.map((k) => ({
      k,
      past: L[k].recent.filter(shown),
      fut: L[k].upcoming.filter(shown),
      gone: [...L[k].recent, ...L[k].upcoming].filter((c) => !shown(c)),
    }));
  };
  const liHtml = (c) => {
    if (c.when === 'exact') {
      const note = noteOf(c);
      return `<div class="li ${cc(c.category)}" data-i="${idx(c)}"><div class="w">${md(c.date)}<i>${dLabel(c.date)}</i></div><div><div class="t">${propOf(c)}${chLink(c)}</div><div class="m">${esc(rawOf(c))} · ${esc(srcLabel(c))}${note ? ' · ' + esc(note) : ''}</div></div></div>`;
    }
    return `<div class="li fz ${cc(c.category)}" data-i="${idx(c)}"><div class="w">${esc(c.phrase)}${c.past ? '<i>(지난 일) · 미확정</i>' : '<i>날짜 미확정</i>'}</div><div><div class="t">${propOf(c)}${chLink(c)}</div><div class="m">${esc(rawOf(c))} · ${esc(srcLabel(c))}${esc(pubTxt(c))}</div></div></div>`;
  };
  const renderLanes = () => {
    if (!CHANGES.length) {
      $('#lanesNote').textContent = '';
      $('#lanes').innerHTML = `<div class="empty">${NO_CHANGES}</div>`;
      return;
    }
    const sets = laneSets();
    const sum = (key) => sets.reduce((a, s) => a + s[key].length, 0);
    const nRecent = sum('past'), nUp = sum('fut'), nHidden = sum('gone');
    const recFz = sets.some((s) => s.past.some((c) => c.when !== 'exact'));
    const upAllFz = sets.every((s) => s.fut.every((c) => c.when !== 'exact'));
    const row = ({ k, past, fut, gone }) => `<div class="ln ${cc(k)}" data-lane="${k}"><b>${esc(LABEL[k])}</b><span>최근 시행 ${past.length} · 예정 ${fut.length}${gone.length ? ` · 기간 밖 ${gone.length}` : ''}</span></div>
      <div class="cell" data-lane="${k}" data-h="최근 시행">${past.length ? past.map(liHtml).join('') : `<span class="none">${gone.length ? `이 기간엔 없음 (기간 밖 ${gone.length}건)` : NONE}</span>`}</div>
      <div class="nowc" data-lane="${k}"></div>
      <div class="cell fzcell" data-lane="${k}" data-h="예정">${fut.length ? fut.map(liHtml).join('') : `<span class="none">${NONE}</span>`}</div>`;
    $('#lanesNote').textContent = nHidden ? `띠 기간(±${st.range}개월) 밖 ${nHidden}건 숨김 · 미확정은 항상 보임` : `띠 기간(±${st.range}개월) 안 항목 · 미확정은 항상 보임`;
    $('#lanes').innerHTML = `<div class="lanes">
      <div class="lh"></div><div class="lh">최근 시행 · ${nRecent}건${recFz ? ' (지난 미확정 포함)' : ''}</div><div class="nowh">오늘</div><div class="lh fzh">예정 · ${nUp}건${nUp && upAllFz ? ' (모두 날짜 미확정)' : ''}</div>
      ${sets.map(row).join('')}
    </div>`;
  };

  // ── 모바일: 띠 아래 요약 · 종류별 묶음 · 하단 시트 ──
  const pStart = (c) => (c.when === 'period' ? c.period.start : '9999-99-99');
  const FZ_ORDER = [...fuzzy].sort((a, b) => (!!a.past - !!b.past) || pStart(a).localeCompare(pStart(b)));

  const renderMQ = () => {
    if (!CHANGES.length) {
      $('#mRecent').innerHTML = `<p class="mnone">${NO_CHANGES}</p>`;
      $('#mFz').innerHTML = '';
      return;
    }
    const w = curWin();
    const ex = CHANGES.filter((c) => c.when === 'exact' && inWin(c.date, w)).sort((a, b) => b.date.localeCompare(a.date));
    const fut = ex.filter((c) => c.date > TODAY).length;
    $('#mRecent').innerHTML = `<div class="mh"><b>시행일 확정 ${ex.length}건</b><span>띠 기간 안 · 확정된 예정 ${fut}건</span></div>
      <div class="mlist">${ex.length ? ex.map((c) => `<button type="button" class="mrow ${cc(c.category)}" data-open="i:${idx(c)}" data-i="${idx(c)}" data-cat="${c.category}"><span class="w">${md(c.date)}<i>${dLabel(c.date)}</i></span><span class="t">${propOf(c)}${esc(c.title)}</span><span class="cv" aria-hidden="true"></span></button>`).join('') : '<p class="mnone">이 기간에 시행일이 확정된 항목이 없습니다.</p>'}</div>`;
    $('#mFz').innerHTML = `<div class="mh fz"><b>날짜 미확정 ${fuzzy.length}건</b><span>원문 표현 그대로 · 날짜로 바꾸지 않음</span></div>
      ${FZ_ORDER.length ? `<div class="mfzs">${FZ_ORDER.map((c) => `<button type="button" class="mfz ${cc(c.category)}" data-open="i:${idx(c)}" data-i="${idx(c)}" data-cat="${c.category}"><span class="w"><span class="catdot"></span>${esc(c.phrase)}${c.past ? ' <i>(지난 일)</i>' : ''}</span><span class="t">${propOf(c)}${esc(c.title)}</span></button>`).join('')}</div>` : `<p class="mnone">${NONE}</p>`}`;
  };

  const aiHtml = (c) => {
    if (c.when === 'exact') {
      const note = noteOf(c);
      return `<button type="button" class="ai ${cc(c.category)}" data-open="i:${idx(c)}" data-i="${idx(c)}"><span class="w">${md(c.date)}<i>${dLabel(c.date)}</i></span><span class="tx"><span class="t">${propOf(c)}${esc(c.title)}</span><span class="m">${esc(srcLabel(c))}${note ? ' · ' + esc(note) : ''}</span></span></button>`;
    }
    return `<button type="button" class="ai fz ${cc(c.category)}" data-open="i:${idx(c)}" data-i="${idx(c)}"><span class="w">${esc(c.phrase)}<i>${c.past ? '(지난 일) · 미확정' : '날짜 미확정'}</i></span><span class="tx"><span class="t">${propOf(c)}${esc(c.title)}</span><span class="m">${esc(srcLabel(c))}${esc(pubTxt(c))}</span></span></button>`;
  };
  const renderAcc = () => {
    if (!CHANGES.length) {
      $('#acc').innerHTML = `<div class="empty">${NO_CHANGES}</div>`;
      return;
    }
    const sets = laneSets();
    const nextR = RANGE_KEYS.find((r) => r > st.range);
    // 처음에는 항목이 있는 종류만 펼친다
    if (!st.open) st.open = new Set(sets.filter((s) => s.past.length || s.fut.length).map((s) => s.k));
    $('#acc').innerHTML = sets.map(({ k, past: p, fut: f, gone: g }) => {
      const open = st.open.has(k), id = 'ab-' + CK[k];
      return `<div class="ag ${cc(k)}" data-lane="${k}">
        <button type="button" class="ah" data-acc="${k}" aria-expanded="${open}" aria-controls="${id}"><span class="catdot"></span><b>${esc(LABEL[k])}</b><span class="cnt">최근 ${p.length} · 예정 ${f.length}${g.length ? ` · 기간 밖 ${g.length}` : ''}</span><span class="chev" aria-hidden="true"></span></button>
        <div class="ab" id="${id}"${open ? '' : ' hidden'}>
          <div class="as">최근 시행 ${p.length}건</div>
          ${p.length ? p.map(aiHtml).join('') : `<p class="anone">${g.length ? '이 기간엔 없음' : NONE}</p>`}
          ${g.length ? (nextR ? `<button type="button" class="awide mo-r" data-r="${nextR}">띠 기간 밖 ${g.length}건 · ±${nextR}개월로 넓혀 보기</button>` : `<p class="anone">띠 기간 밖 ${g.length}건</p>`) : ''}
          <div class="as fz">예정 ${f.length}건</div>
          ${f.length ? f.map(aiHtml).join('') : `<p class="anone">${NONE}</p>`}
        </div>
      </div>`;
    }).join('');
  };

  const kickOf = (c) => `<span class="tagx${c.when === 'exact' ? '' : ' fz'}">${c.when === 'exact' ? '시행일 확정' : '날짜 미확정'}</span>${propOf(c)}<span><span class="catdot ${cc(c.category)}"></span>${esc(LABEL[c.category])}</span>`;
  const kvItem = (c) => {
    const ex = c.when === 'exact';
    const when = ex
      ? `<b class="mono">${fmtD(c.date)}</b> · ${dLabel(c.date)} (${dTxt(c.date)})<span class="sm">${c.origin === 'rates' ? '공시표 시행시기' : '원문에 날짜가 정확히 적힌 시행일'}</span>`
      : `<b>${esc(c.phrase)}</b>${c.past ? ' (지난 일)' : ''}<span class="sm">${c.when === 'period' ? `띠에는 ${esc(periodSay(c.period))}로 그림 · 정확한 날짜 아님` : '정확한 날짜가 없어 띠에 그리지 않음'}</span>`;
    const note = noteOf(c), srcs = srcsOf(c), first = srcs[0];
    return `<dl class="kv">
      <dt>종류</dt><dd><span class="catdot ${cc(c.category)}"></span>${esc(LABEL[c.category])}</dd>
      ${c.status === 'proposed' ? `<dt>상태</dt><dd>${PROP}입법·규정변경예고 단계입니다</dd>` : ''}
      <dt>${ex ? '시행일' : '원문 표현'}</dt><dd>${when}</dd>
      <dt>원문 근거</dt><dd>${esc(c.quote || c.phrase)}</dd>
      ${note ? `<dt>내용</dt><dd>${esc(note)}</dd>` : ''}
      <dt>출처</dt><dd>${srcLinks(srcs)}${c.origin !== 'rates' && isIso(c.announced) ? ` · ${fmtD(c.announced)} 발표` : ''}</dd>
    </dl>
    ${first ? `<a class="bs-go" href="${esc(safeUrl(first.url))}" target="_blank" rel="noopener">원문 보기 · ${esc(first.name)} <span aria-hidden="true">↗</span></a>` : ''}`;
  };
  const rateKv = (g) => `<dl class="kv">
      <dt>종류</dt><dd><span class="catdot c-car"></span>자동차 · 보험료 ${SNAME[g.s]}</dd>
      <dt>시행일</dt><dd><b class="mono">${fmtD(g.date)}</b> · ${dLabel(g.date)} (${dTxt(g.date)})</dd>
      <dt>조정</dt><dd>${g.rs.map((r) => `${esc(r.company)} ${esc(r.kind)} <b class="n mono ${sgn(r.total)}">${esc(pct(r.total))}%</b>${r.reason ? `<span class="sm">${esc(r.reason)}</span>` : ''}`).join('')}</dd>
      <dt>출처</dt><dd>손보협회 공시실 · 공시표 시행시기 기준</dd>
    </dl>`;
  const sheetFor = (k) => {
    const t = k.slice(0, 1), v = k.slice(2);
    if (t === 'd' || t === 'b' || t === 'i') {
      const c = CHANGES[+v];
      return c ? { kick: kickOf(c), title: c.title, body: kvItem(c) } : null;
    }
    if (t === 'm') {
      const cs = v.split(',').map((i) => CHANGES[+i]).filter(Boolean);
      if (!cs.length) return null;
      return {
        kick: `<span class="tagx">시행일 확정</span><span>가까운 날짜 ${cs.length}건을 한 점으로 묶음</span>`,
        title: `${md(cs[0].date)} ~ ${md(cs[cs.length - 1].date)} 시행 ${cs.length}건`,
        body: cs.slice().reverse().map((c) => `<div class="bs-it"><div class="bs-k">${kickOf(c)}</div><h3>${esc(c.title)}</h3>${kvItem(c)}</div>`).join(''),
      };
    }
    if (t === 'r' || t === 'q') {
      const gs = v.split(',').map((d) => RG.find((g) => g.date === d)).filter(Boolean);
      if (!gs.length) return null;
      const g = gs.length === 1 ? gs[0] : rateMerge(gs);
      return {
        kick: '<span class="tagx">보험료 조정</span><span><span class="catdot c-car"></span>자동차</span>',
        title: gs.length === 1 ? `${md(g.date)} 자동차보험료 ${SNAME[g.s]} (${g.label})` : `${md(gs[0].date)} ~ ${md(gs[gs.length - 1].date)} 자동차보험료 조정 ${g.rs.length}건`,
        body: gs.slice().reverse().map((x) => `<div class="bs-it">${rateKv(x)}</div>`).join('') + '<p class="bs-nolink">보험료 조정 공시에는 항목별 원문 링크가 수집되지 않았습니다. 전체 목록은 아래 "자동차보험료 조정"에 있습니다.</p>',
      };
    }
    return null;
  };
  let bsFrom = null, bsTimer = 0;
  const INERT = ['#app', '#tabs', '#themeBtn'];
  const openSheet = (k, from) => {
    const s = sheetFor(k);
    if (!s) return;
    win.clearTimeout(bsTimer);
    const bs = $('#bs'), bg = $('#bsBg');
    $('#bsKick').innerHTML = s.kick; $('#bsTitle').textContent = s.title; $('#bsBody').innerHTML = s.body; $('#bsBody').scrollTop = 0;
    $$('.mrow.on, .mfz.on').forEach((el) => el.classList.remove('on'));
    if (from && from.matches('.mrow, .mfz')) from.classList.add('on');
    bsFrom = from || null;
    bs.style.transform = ''; bs.hidden = false; bg.hidden = false;
    void bs.offsetHeight; // 시작 위치를 잡은 뒤 올라오게
    bs.classList.add('open'); bg.classList.add('open');
    INERT.forEach((s2) => { $(s2).inert = true; });
    doc.documentElement.classList.add('lock');
    $('#bsX').focus({ preventScroll: true });
  };
  const closeSheet = () => {
    const bs = $('#bs'), bg = $('#bsBg');
    if (bs.hidden) return;
    bs.classList.remove('open', 'drag'); bg.classList.remove('open'); bs.style.transform = '';
    INERT.forEach((s2) => { $(s2).inert = false; });
    doc.documentElement.classList.remove('lock');
    bsTimer = win.setTimeout(() => { bs.hidden = true; bg.hidden = true; }, 230);
    $$('.mrow.on, .mfz.on').forEach((el) => el.classList.remove('on'));
    if (st.pin) { st.pin = null; applyPin(false); }
    if (bsFrom && root.contains(bsFrom)) bsFrom.focus({ preventScroll: true });
    bsFrom = null;
  };

  // ── 아래 영역 ──
  const topicOf = (g) => (LABEL[g.topic] ? g.topic : 'general');
  const chipsHtml = (cls = '') => `<div class="chips${cls ? ' ' + cls : ''}" role="group" aria-label="보험 종류 필터">${['all', ...LANE_KEYS].map((k) => k === 'all'
    ? '<button type="button" class="chip on" data-f="all" aria-pressed="true">전체</button>'
    : `<button type="button" class="chip ${cc(k)}" data-f="${k}" aria-pressed="false"><span class="catdot"></span>${esc(LABEL[k])}</button>`).join('')}</div>`;
  const newsItem = (n) => {
    const k = topicOf(n), srcs = arr(n.sources);
    return `<div class="item ${cc(k)}" data-cat="${k}"><div class="top"><span class="cat"><span class="catdot"></span>${esc(LABEL[k])}</span>${n.kind === 'insurer' ? '<span>· 보험사 발표</span>' : ''}${srcs.length > 1 ? `<span>· ${srcs.length}곳 보도</span>` : ''}${isIso(n.published) ? `<span>· ${mdY(n.published)}</span>` : ''}</div><h3>${esc(n.title)}</h3>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}<div class="srcs">${srcs.length ? srcLinks(srcs) : link('원문', n.url)}</div></div>`;
  };
  const officialRows = () => OFFICIAL.map((o) => {
    const k = topicOf(o), src = arr(o.sources)[0]?.name ?? '';
    return `<div class="row ${cc(k)}" data-cat="${k}"><span class="off">공식</span><span class="ot"><span class="catdot"></span>${link(o.title, o.url)}<br><small style="color:var(--ink3)">${esc(src)} · ${esc(LABEL[k])}</small></span><span class="n dt">${isIso(o.published) ? mdY(o.published) : ''}</span></div>`;
  }).join('');
  const industryRows = () => INDUSTRY.map((i) => `<div class="row">${link(i.title, i.url)}<span class="n">${arr(i.sources).length || 1}곳</span></div>`).join('');
  const rateRows = () => RATES.map((r) => `<div class="row" data-rd="${esc(r.effective)}"><span>${esc(r.company)} · ${esc(r.kind)}</span><span class="n ${sgn(r.total)}">${mdY(r.effective)} &nbsp; ${esc(pct(r.total))}%</span></div>`).join('');
  const statusHtml = () => `<div class="status">${STATUS.map((s) => {
    const name = esc(SOURCE_NAME[s.source] || s.source);
    const note = s.note ? ' · ' + esc(s.note) : '';
    if (s.disabled) return `<span class="off">– ${name} · 꺼짐${note}</span>`;
    if (!s.ok) return `<span class="w">✕ ${name} · 실패${s.error ? ': ' + esc(s.error) : ''}${note}</span>`;
    return `<span class="${s.note ? 'w' : ''}">${s.note ? '⚠' : '✓'} ${name}${Number.isFinite(s.count) ? ` · ${s.count}건` : ''}${note}</span>`;
  }).join('')}</div>`;

  const fails = STATUS.filter((s) => !s.ok && !s.disabled);
  const sig = fails.length
    ? `<a class="sig bad" href="#sec-stat" title="${esc(fails.map((s) => SOURCE_NAME[s.source] || s.source).join(', '))}">수집 실패 ${fails.length}곳</a>`
    : '<span class="sig">수집 정상</span>';
  const newToday = Number.isFinite(counts.newToday) ? counts.newToday : NEWS.length;
  const ruleText = BANDED.slice(0, 3).map((c) => `${esc(c.phrase)} → ${esc(periodSay(c.period))}`).join(', ') + (BANDED.length > 3 ? ' 등' : '');
  const empty = (s) => `<div class="empty">${s}</div>`;

  root.innerHTML = `
  <button id="themeBtn" type="button"></button>
  <div class="wrap" id="app">
    <header>
      <div><h1>보험 <span>레이더</span></h1></div>
      <div class="d">${sig}${esc(stampOf(d0.generatedAt))} 갱신 · 새 소식 ${esc(newToday)} · 공식 발표 ${OFFICIAL.length}</div>
    </header>
    <div class="mbar mo" id="mbar">${chipsHtml()}</div>
    <section class="card chg" id="sec-chg" aria-label="바뀌는 것">
      <h2>바뀌는 것 <small id="period"></small></h2>
      <div class="ctl">
        <div class="step">① 한눈에 보기 · 왼쪽은 지난 시행, 오른쪽은 예정</div>
        <div class="opts">
          <span class="seg" role="group" aria-label="띠 기간">${RANGE_KEYS.map((r) => `<button type="button" data-r="${r}" aria-pressed="false">±${r}개월</button>`).join('')}</span>
          <button type="button" class="tg" id="rateTg" aria-pressed="false" aria-label="보험료 조정 겹쳐 보기"><span class="sw"></span><span class="d-only">보험료 조정 겹쳐 보기</span><span class="mo">보험료</span></button>
        </div>
      </div>
      <div class="strip" id="strip">
        <div class="rlab" id="rlab"></div>
        <div class="axbox" id="axbox"><div class="axis" id="axis"></div></div>
        <button type="button" class="fzb" id="fzb" aria-label="날짜 미확정 항목을 아래 표에서 강조"></button>
      </div>
      <div class="moor" id="mOor"></div>
      <p class="mrule mo"><span class="ico-dot"></span>점 = 정확한 시행일 · <span class="ico-band"></span>점선 = 원문이 말한 기간 · 누르면 상세</p>
      <div class="mq mo" id="mq"><div id="mRecent"></div><div id="mFz"></div></div>
      <div class="info" id="info" aria-live="polite"></div>
      <p class="rule"><span class="ico-dot"></span><b>점</b> = 원문에 날짜가 정확히 적힌 시행일 · <span class="ico-band"></span><b>점선 막대</b> = 원문이 말한 기간${ruleText ? `(${ruleText})` : ''}. 정확한 날짜가 아님 · 기간을 말하지 않은 항목은 막대 없이 오른쪽 묶음에만</p>
      <div class="hint"><span class="lg"><span><span class="catdot c-car"></span>자동차</span><span><span class="catdot c-med"></span>실손</span><span><span class="catdot c-life"></span>생명·건강·상해</span><span><span class="catdot c-ind"></span>제도·공통</span></span><span class="lg hide" id="rateLg">보험료 <span><span class="ico-rp up"></span>인상</span><span><span class="ico-rp dn"></span>인하</span><span><span class="ico-rp zero"></span>0%</span></span></div>
      <div class="sub"><div class="step">② 보험 종류별로 보기</div><small id="lanesNote"></small></div>
      <div id="lanes"></div>
      <div class="acc" id="acc"></div>
    </section>
    ${chipsHtml('d-only')}
    <div class="below">
      <section id="sec-news"><h2 class="sh">오늘 소식 <small>최근 3일 · ${NEWS.length}개 주제</small></h2><div class="news" data-list>${NEWS.map(newsItem).join('')}<div class="empty hide">${NEWS.length ? '이 종류의 소식이 없습니다' : '오늘 새 소식 없음'}</div></div></section>
      <aside class="side">
        <div class="card" id="sec-off"><h2>공식 발표 <small>정부·감독기관·협회</small></h2><div data-list>${officialRows()}<div class="empty hide">${OFFICIAL.length ? '이 종류의 발표가 없습니다' : NONE}</div></div></div>
        <div class="card" id="sec-rate"><h2>자동차보험료 조정 <small>손보협회 공시실 · 띠에 겹쳐 볼 수 있음</small></h2>${RATES.length ? rateRows() : empty(NONE)}</div>
        <div class="card" id="sec-ind"><h2>업계 동향</h2>${INDUSTRY.length ? industryRows() : empty(NONE)}</div>
        <div class="card" id="sec-stat"><h2>수집 상태</h2>${STATUS.length ? statusHtml() : empty(NONE)}</div>
      </aside>
    </div>
    <footer id="sec-note">${esc(DISCLAIMER)}</footer>
  </div>
  <nav class="tabs" id="tabs" aria-label="섹션 바로 가기">
    <a href="#sec-chg" data-sec="sec-chg">바뀌는 것</a>
    <a href="#sec-news" data-sec="sec-news">소식</a>
    <a href="#sec-off" data-sec="sec-off">발표</a>
    <a href="#sec-ind" data-sec="sec-ind">동향</a>
    <a href="#sec-rate" data-sec="sec-rate">보험료</a>
    <a href="#sec-stat" data-sec="sec-stat">상태·고지</a>
  </nav>
  <div class="bs-bg" id="bsBg" hidden></div>
  <div class="bs" id="bs" role="dialog" aria-modal="true" aria-labelledby="bsTitle" hidden>
    <div class="bs-hd" id="bsHd">
      <span class="grip" aria-hidden="true"></span>
      <div class="bs-k" id="bsKick"></div>
      <h2 id="bsTitle"></h2>
      <button type="button" class="bs-x" id="bsX" aria-label="상세 닫기"><b aria-hidden="true">▾</b>닫기</button>
    </div>
    <div class="bs-bd" id="bsBody"></div>
  </div>`;

  // ── 필터·강조 적용 ──
  const applyFilter = () => {
    const f = st.filter, all = f === 'all';
    $$('.chip').forEach((c) => { const sel = c.dataset.f === f; c.classList.toggle('on', sel); c.setAttribute('aria-pressed', String(sel)); });
    $$('.below [data-cat]').forEach((el) => el.classList.toggle('hide', !all && el.dataset.cat !== f));
    $$('.lanes [data-lane]').forEach((el) => el.classList.toggle('dim', !all && el.dataset.lane !== f));
    $$('.strip [data-cat]').forEach((el) => el.classList.toggle('dim', !all && el.dataset.cat !== f));
    $$('.below [data-list]').forEach((l) => {
      const any = [...l.querySelectorAll('[data-cat]')].some((el) => !el.classList.contains('hide'));
      l.querySelector('.empty').classList.toggle('hide', any);
    });
    // 모바일: 띠 아래 요약은 흐리게, 종류별 묶음은 고른 종류만 남기고 펼친다
    $$('.mq [data-cat]').forEach((el) => el.classList.toggle('dim', !all && el.dataset.cat !== f));
    $$('.acc .ag').forEach((el) => el.classList.toggle('hide', !all && el.dataset.lane !== f));
    if (!all && st.open && !st.open.has(f)) {
      st.open.add(f);
      const ag = $$('.acc .ag').find((el) => el.dataset.lane === f);
      if (ag) { ag.querySelector('.ah').setAttribute('aria-expanded', 'true'); ag.querySelector('.ab').hidden = false; }
    }
  };
  const applyPin = (scroll) => {
    $$('.li.hl, .ai.hl, .strip .on').forEach((el) => el.classList.remove('hl', 'on'));
    const k = st.pin;
    if (k && k !== 'f' && !root.querySelector(`.strip [data-k="${k}"]`)) st.pin = null; // 기간 밖으로 나간 선택은 해제
    if (st.pin === 'f') {
      $('#fzb').classList.add('on');
      const els = $$('.li.fz');
      els.forEach((li) => li.classList.add('hl'));
      if (scroll && els[0]) els[0].scrollIntoView({ block: 'nearest', behavior: smooth() });
    } else if (st.pin) {
      $$(`.strip [data-k="${st.pin}"]`).forEach((el) => el.classList.add('on'));
      if (/^[dbm]:/.test(st.pin)) {
        st.pin.slice(2).split(',').forEach((i, n) => {
          const li = root.querySelector(`.li[data-i="${i}"]`);
          if (li) { li.classList.add('hl'); if (scroll && !n) li.scrollIntoView({ block: 'nearest', behavior: smooth() }); }
          $$(`.ai[data-i="${i}"]`).forEach((a) => a.classList.add('hl'));
        });
      }
    }
    showInfo(st.pin);
  };
  const renderAll = (recenter) => { renderStrip(recenter); renderLanes(); renderAcc(); renderMQ(); applyFilter(); applyPin(false); };
  renderAll(true);
  // 글꼴이 늦게 적용돼 폭이 바뀌면 한 번 더 그림
  doc.fonts?.ready?.then(() => { if (!ac.signal.aborted) { renderStrip(true); applyFilter(); applyPin(false); } });

  // ── 동작 ──
  root.addEventListener('click', (e) => {
    const rb = e.target.closest('.seg button, .oor[data-r], .mo-r[data-r]');
    if (rb) { st.range = +rb.dataset.r; st.userRange = true; renderAll(true); return; }
    if (e.target.closest('#rateTg')) { st.rates = !st.rates; renderStrip(false); applyFilter(); applyPin(false); return; }
    if (e.target.closest('.info .x')) { st.pin = null; applyPin(false); return; }
    const mk = e.target.closest('.strip [data-k]');
    if (mk && isM()) { st.pin = mk.dataset.k; applyPin(false); openSheet(mk.dataset.k, mk); return; }
    if (mk) { const k = mk.dataset.k; st.pin = st.pin === k ? null : k; applyPin(true); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openSheet(op.dataset.open, op); return; }
    const ah = e.target.closest('.ah');
    if (ah) {
      const k = ah.dataset.acc, open = !st.open.has(k);
      if (open) st.open.add(k); else st.open.delete(k);
      ah.setAttribute('aria-expanded', String(open));
      $('#' + ah.getAttribute('aria-controls')).hidden = !open;
      return;
    }
    const tab = e.target.closest('#tabs a');
    if (tab) {
      const el = doc.getElementById(tab.dataset.sec);
      if (el) { e.preventDefault(); el.scrollIntoView({ block: 'start', behavior: smooth() }); }
      return;
    }
    if (e.target.closest('#fzb')) { st.pin = st.pin === 'f' ? null : 'f'; applyPin(true); return; }
    const chip = e.target.closest('.chip');
    if (chip) { st.filter = chip.dataset.f; applyFilter(); }
  }, on);
  const strip = $('#strip');
  strip.addEventListener('mouseover', (e) => {
    const mk = e.target.closest('[data-k]');
    if (mk) showInfo(mk.dataset.k, mk.dataset.k !== st.pin);
    else if (e.target.closest('#fzb')) showInfo('f', st.pin !== 'f');
  }, on);
  strip.addEventListener('mouseleave', () => showInfo(st.pin), on);
  strip.addEventListener('focusin', (e) => { const mk = e.target.closest('[data-k]'); if (mk) showInfo(mk.dataset.k, mk.dataset.k !== st.pin); }, on);
  strip.addEventListener('focusout', () => showInfo(st.pin), on);
  root.addEventListener('mouseover', (e) => {
    const li = e.target.closest('.li');
    $$('.strip .peek').forEach((d) => d.classList.remove('peek'));
    if (li) $$(`.strip [data-i="${li.dataset.i}"]`).forEach((d) => d.classList.add('peek'));
  }, on);
  let rz = 0;
  win.addEventListener('resize', () => {
    win.clearTimeout(rz);
    rz = win.setTimeout(() => { if ($('#axbox').clientWidth !== lastW) { renderStrip(true); applyFilter(); applyPin(false); } }, 120);
  }, on);

  // ── 모바일 동작: 시트 닫기 · 화면 폭 전환 · 섹션 탭 ──
  $('#bsX').addEventListener('click', closeSheet, on);
  $('#bsBg').addEventListener('click', closeSheet, on);
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#bs').hidden) { e.preventDefault(); closeSheet(); } }, on);
  let dragY = null;
  const hd = $('#bsHd');
  const passive = { passive: true, signal: ac.signal };
  hd.addEventListener('touchstart', (e) => { if (e.target.closest('.bs-x')) return; dragY = e.touches[0].clientY; $('#bs').classList.add('drag'); }, passive);
  hd.addEventListener('touchmove', (e) => { if (dragY === null) return; $('#bs').style.transform = `translateY(${Math.max(0, e.touches[0].clientY - dragY)}px)`; }, passive);
  hd.addEventListener('touchend', (e) => {
    if (dragY === null) return;
    const dy = e.changedTouches[0].clientY - dragY; dragY = null;
    $('#bs').classList.remove('drag');
    if (dy > 80) closeSheet(); else $('#bs').style.transform = '';
  }, on);
  const SECS = $$('#tabs a').map((a) => a.dataset.sec);
  let tabRaf = 0;
  const syncTabs = () => {
    tabRaf = 0;
    if (!isM()) return;
    const mb = $('#mbar');
    mb.classList.toggle('stuck', win.scrollY > 0 && mb.getBoundingClientRect().top <= 0.5);
    let cur = SECS[0];
    if (win.innerHeight + win.scrollY >= doc.documentElement.scrollHeight - 4) cur = SECS[SECS.length - 1];
    else SECS.forEach((id) => { const el = doc.getElementById(id); if (el && el.getBoundingClientRect().top <= 140) cur = id; });
    $$('#tabs a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.sec === cur)));
  };
  const onMQ = () => { closeSheet(); if (!st.userRange) st.range = defRange(); renderAll(true); syncTabs(); };
  if (MQ.addEventListener) MQ.addEventListener('change', onMQ, on); else MQ.addListener(onMQ);
  win.addEventListener('scroll', () => { if (!tabRaf) tabRaf = win.requestAnimationFrame(syncTabs); }, passive);
  syncTabs();

  // ── 테마 ──
  let mode = ctx?.mode === 'dark' ? 'dark' : 'light';
  const btn = $('#themeBtn');
  // 데스크톱은 글자, 모바일은 아이콘만(44px 버튼)
  const syncTheme = () => {
    const dark = mode === 'dark';
    btn.innerHTML = dark ? '☀<span class="tl"> 밝은 모드</span>' : '☾<span class="tl"> 다크</span>';
    btn.setAttribute('aria-label', dark ? '밝은 모드로 바꾸기' : '다크 모드로 바꾸기');
  };
  btn.addEventListener('click', () => {
    const next = ctx?.toggleMode?.();
    mode = next === 'dark' || next === 'light' ? next : mode === 'dark' ? 'light' : 'dark';
    syncTheme();
  }, on);
  syncTheme();
}
