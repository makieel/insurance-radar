import { XMLParser } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import { isIsoDate, kstDate } from '../lib/dates.ts';
import { fetchText } from '../lib/http.ts';
import { textOf } from '../lib/xml.ts';
import type { RawItem } from '../schema.ts';
import type { CollectCtx, Collector } from './types.ts';

type FeedResult = { items: RawItem[]; bodies: Record<string, string> };
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('보험사 목록 응답 형식을 확인할 수 없습니다');
  return value;
}

function plain(value: unknown): string {
  return parse(textOf(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|h[1-6]|tr|td)>/gi, ' '))
    .text.replace(/\s+/g, ' ').trim();
}

function dateOf(value: unknown): string {
  const match = textOf(value).match(/^(\d{4})[-.]?(\d{2})[-.]?(\d{2})(?:$|\D)/);
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  if (!isIsoDate(date)) throw new Error('보험사 게시일 형식을 확인할 수 없습니다');
  return date;
}

function itemOf(source: RawItem['source'], id: unknown, title: unknown, url: string, published: string, hints: string[] = []): RawItem {
  const key = textOf(id);
  const heading = plain(title);
  if (!/^\d+$/.test(key) || !heading) throw new Error('보험사 글 번호 또는 제목이 없습니다');
  return { id: `${source}:${key}`, source, title: heading, url, published, hints, attachments: [] };
}

export function parseHanwhaList(json: unknown): RawItem[] {
  return rows(record(json).items).map(value => {
    const row = record(value);
    return itemOf('hanwha', row.seq, row.title,
      `https://company.hanwhalife.com/ko/about/company-overview/newsroom/press/${textOf(row.seq)}`,
      dateOf(row.broadcastDate));
  });
}

const rssParser = new XMLParser({
  ignoreAttributes: false, parseTagValue: false,
  isArray: name => name === 'item' || name === 'category',
});

export function parseKyoboFeed(xml: string): FeedResult {
  const entries = rows(rssParser.parse(xml)?.rss?.channel?.item ?? []);
  const items: RawItem[] = [];
  const bodies: Record<string, string> = {};
  for (const value of entries) {
    const row = record(value);
    const hints = rows(row.category ?? []).map(textOf);
    if (!hints.includes('보도자료')) continue;
    const guid = new URL(plain(row.guid));
    const url = new URL(plain(row.link));
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    const date = new Date(textOf(row.pubDate));
    if (Number.isNaN(date.getTime())) throw new Error('교보 RSS 게시일을 확인할 수 없습니다');
    const item = itemOf('kyobo', guid.searchParams.get('p'), row.title, url.href, kstDate(date), hints);
    if (Object.hasOwn(bodies, item.id)) continue;
    items.push(item);
    bodies[item.id] = plain(row['content:encoded'] || row.description);
  }
  return { items, bodies };
}

export function parseSamsungfireList(json: unknown): FeedResult {
  const data = record(record(record(json).responseMessage).body).data;
  const items: RawItem[] = [];
  const bodies: Record<string, string> = {};
  for (const value of rows(record(data).AMList)) {
    const row = record(value);
    const item = itemOf('samsungfire', row.articleId, row.subject,
      `https://www.samsungfire.com/vh/page/VH.HPMK0602.do?articleId=${textOf(row.articleId)}`,
      dateOf(row.createDate));
    if (Object.hasOwn(bodies, item.id)) continue;
    items.push(item);
    bodies[item.id] = plain(row.content);
  }
  return { items, bodies };
}

export function parseMeritzList(json: unknown): RawItem[] {
  return rows(record(record(json).body).list).map(value => {
    const row = record(value);
    return itemOf('meritz', row.seq, row.tnm,
      `https://www.meritzfire.com/company/media/media-report.do?seq=${textOf(row.seq)}`,
      dateOf(row.regDt));
  });
}

export function parseMeritzDetail(json: unknown): string {
  const model = record(record(record(json).body).model);
  if (typeof model.dtl !== 'string') throw new Error('메리츠 상세 본문이 없습니다');
  return plain(model.dtl);
}

const hanwhaApi = 'https://company.hanwhalife.com/api/comp/v1/get/press-releases';
const jsonHeaders = { 'content-type': 'application/json; charset=UTF-8' };

export const hanwha: Collector = {
  id: 'hanwha',
  async run(ctx) {
    const collected = new Map<string, RawItem>();
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    for (let page = 1; page <= pages; page++) {
      const response = await fetchText(hanwhaApi, {
        fetch: ctx.fetch, method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ page, size: 9, category: 'PRESS_RELEASE' }),
      });
      const items = parseHanwhaList(JSON.parse(response));
      if (items.length === 0) break;
      for (const item of items) {
        if (collected.has(item.id)) continue;
        collected.set(item.id, item);
        if (ctx.seen.has(item.id)) continue;
        const detail = record(JSON.parse(await fetchText(`${hanwhaApi}/${item.id.split(':')[1]}`, {
          fetch: ctx.fetch, method: 'POST', headers: jsonHeaders, body: '{}',
        })));
        if (typeof detail.content !== 'string') throw new Error('한화 상세 본문이 없습니다');
        ctx.putBody(item.id, plain(detail.content));
      }
    }
    return { items: [...collected.values()] };
  },
};

export const kyobo: Collector = {
  id: 'kyobo',
  async run(ctx) {
    const parsed = parseKyoboFeed(await fetchText('https://news.kyobo.com/feed/', { fetch: ctx.fetch }));
    for (const item of parsed.items) if (!ctx.seen.has(item.id)) ctx.putBody(item.id, parsed.bodies[item.id]);
    return { items: parsed.items };
  },
};

export const samsungfire: Collector = {
  id: 'samsungfire',
  async run(ctx) {
    const collected = new Map<string, RawItem>();
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    for (let page = 1; page <= pages; page++) {
      const header = {
        tranId: 'VH.HDBS0101', pageId: 'VH.HPMK0602', panelId: '', longTran: '',
        deviceInfo: { modelNumber: 'PC', osName: '', osVersion: '', appName: '', appVersion: '', browserVersion: '', telecomAgency: '', networkType: 'LAN' },
      };
      const body = new URLSearchParams({
        header: JSON.stringify(header),
        body: JSON.stringify({ BBS_ID: '00000015', CUR_PAGE: String(page), SEARCH_CD: '02', SEARCH_WORD: '' }),
      }).toString();
      const response = await fetchText('https://www.samsungfire.com/vh/data/VH.HDBS0101.do', {
        fetch: ctx.fetch, method: 'POST', body,
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          referer: 'https://www.samsungfire.com/vh/page/VH.HPMK0602.do', 'x-requested-with': 'XMLHttpRequest',
        },
      });
      const parsed = parseSamsungfireList(JSON.parse(response));
      if (parsed.items.length === 0) break;
      for (const item of parsed.items) {
        if (collected.has(item.id)) continue;
        collected.set(item.id, item);
        if (!ctx.seen.has(item.id)) ctx.putBody(item.id, parsed.bodies[item.id]);
      }
    }
    return { items: [...collected.values()] };
  },
};

async function meritzRequest(ctx: CollectCtx, service: string, body: Record<string, unknown>): Promise<unknown> {
  const header = {
    encryDivCd: '0', globId: '', rcvmsgSrvId: `f.cg.he.cm.mi.o.bc.NewsBc.${service}`,
    resultRcvmsgSrvId: '', esbIntfId: '', exsIntfId: '', ipv6Addr1: '', ipv6Addr2: '',
    teleMsgMacAdr: '', envirInfoDivCd: '', firstTranssLcatgBizafairCd: '', transsLcatgBizafairCd: '',
    reqRespnsDivCd: 'Q', syncDivCd: 'S', teleMsgReqDttm: ctx.now.toISOString().replace(/\D/g, '').slice(0, 17),
    prcesResultDivCd: '', teleMsgRespnsDttm: '', clienTrespnsDttm: '', handcapLcatgBizafairCd: '',
    teleMsgVerDivCd: '', langDivCd: 'KR', belongGrpCd: '', empNo: '', empId: '', dptCd: '',
    hgrkDptCd: '', nxupDptCd: '', transGrpCd: 'F', screenId: '/company/media/media-report.do', lowrnkScreenId: '/', resveLet: '',
  };
  return JSON.parse(await fetchText('https://www.meritzfire.com/json.smart', {
    fetch: ctx.fetch, method: 'POST', body: JSON.stringify({ header, body }),
    headers: { ...jsonHeaders, accept: 'application/json, text/plain, */*', referer: 'https://www.meritzfire.com/company/media/media-report.do' },
  }));
}

export const meritz: Collector = {
  id: 'meritz',
  async run(ctx) {
    const collected = new Map<string, RawItem>();
    const pages = ctx.backfill ? ctx.config.limits.backfillPages : 1;
    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      const base = { pageNo, pageSize: 10, chnDivCd: 'W', bbsType: '415' };
      const items = parseMeritzList(await meritzRequest(ctx, 'retrieveNewsLst', { ...base, subCd: '', srhKeyword: '' }));
      if (items.length === 0) break;
      for (const item of items) {
        if (collected.has(item.id)) continue;
        collected.set(item.id, item);
        if (ctx.seen.has(item.id)) continue;
        const detail = await meritzRequest(ctx, 'retrieveNewsRead', { ...base, seq: Number(item.id.split(':')[1]) });
        ctx.putBody(item.id, parseMeritzDetail(detail));
      }
    }
    return { items: [...collected.values()] };
  },
};
