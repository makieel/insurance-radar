import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';
import { kstDate } from '../lib/dates.ts';
import { fetchText } from '../lib/http.ts';
import { normalizeUrl } from '../lib/text.ts';
import type { RawItem } from '../schema.ts';
import type { Collector } from './types.ts';

const plain = (html: string) => parse(html).text.replace(/\s+/g, ' ').trim();

export const naver: Collector = {
  id: 'naver',
  async run(ctx) {
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('키 없음');
    const query = [ctx.config.keywords.auto[0], ctx.config.keywords.medical[0], ctx.config.keywords.life[0]]
      .filter(Boolean).join(' | ');
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=100&sort=date`;
    const response = JSON.parse(await fetchText(url, {
      fetch: ctx.fetch, headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    })) as { items?: { title: string; originallink: string; pubDate: string; description: string }[] };
    if (!Array.isArray(response.items)) throw new Error('네이버 목록 응답 형식을 확인할 수 없습니다');
    const items: RawItem[] = [];
    const collected = new Set<string>();
    for (const row of response.items) {
      const original = new URL(row.originallink);
      if (!/^https?:$/.test(original.protocol)) throw new Error('네이버 원문 주소를 확인할 수 없습니다');
      const date = new Date(row.pubDate);
      if (Number.isNaN(date.getTime())) throw new Error('네이버 게시일을 확인할 수 없습니다');
      const id = `naver:${createHash('sha256').update(normalizeUrl(original.href)).digest('hex')}`;
      if (collected.has(id)) continue;
      collected.add(id);
      items.push({
        id, source: 'naver', title: plain(row.title), url: original.href,
        published: kstDate(date), hints: [], attachments: [],
      });
      if (!ctx.seen.has(id)) ctx.putBody(id, plain(row.description));
    }
    return { items };
  },
};
