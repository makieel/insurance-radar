import { daysBetween } from '../lib/dates.ts';
import { SOURCE_KINDS } from '../schema.ts';
import type { Category, NewsGroup, RawItem, SourceKind, SourceRef } from '../schema.ts';

export interface GroupInput {
  item: RawItem;
  topic: Category | 'industry';
  kind: SourceKind;
  sourceName: string;
}

const HANGUL_RUN = /[가-힣一-鿿]+/g;
const WORD = /\d+(?:\.\d+)?|[a-z]+/g;

/**
 * 제목 비교용 토큰 집합. 괄호·따옴표·기호·띄어쓰기를 지운 한글(한자 포함) 2글자 묶음과 숫자·영단어.
 * 띄어쓰기를 지우는 것은 "생명보험업계"와 "생보 업계"처럼 띄어쓰기가 다른 제목을 맞추기 위해서다.
 */
export function titleKey(title: string): Set<string> {
  // 언론이 자주 쓰는 한자 약칭(車보험)을 한글로 맞춘다.
  const s = title.normalize('NFKC').toLowerCase().replace(/車/g, '차').replace(/社/g, '사');
  const key = new Set<string>();
  const joined = s.replace(/[^가-힣一-鿿0-9a-z]/g, '');
  for (const run of joined.match(HANGUL_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) key.add(run.slice(i, i + 2));
  }
  for (const w of s.match(WORD) ?? []) key.add(w);
  return key;
}

export function similar(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka.size || !kb.size) return false;
  let inter = 0;
  for (const t of ka) if (kb.has(t)) inter++;
  return inter / (ka.size + kb.size - inter) >= 0.45;
}

function kindRank(kind: SourceKind): number {
  return SOURCE_KINDS.indexOf(kind);
}

/** 대표: SOURCE_KINDS 순서가 앞인 글, 같으면 먼저 게시된 글 */
function pickRepresentative(members: GroupInput[]): GroupInput {
  return members.reduce((best, m) => {
    const d = kindRank(m.kind) - kindRank(best.kind);
    if (d < 0) return m;
    if (d === 0 && m.item.published < best.item.published) return m;
    return best;
  });
}

/** 게시일 차이 2일 이내이고 제목이 비슷하면(또는 같은 id면) 한 묶음 */
export function groupItems(inputs: GroupInput[], today: string): NewsGroup[] {
  const sorted = [...inputs].sort((a, b) => a.item.published.localeCompare(b.item.published));
  const clusters: GroupInput[][] = [];
  for (const input of sorted) {
    const target = clusters.find((members) =>
      members.some(
        (m) =>
          m.item.id === input.item.id ||
          (Math.abs(daysBetween(m.item.published, input.item.published)) <= 2 && similar(m.item.title, input.item.title)),
      ),
    );
    if (target) target.push(input);
    else clusters.push([input]);
  }

  const groups = clusters.map((members): NewsGroup => {
    const rep = pickRepresentative(members);
    const ordered = [rep, ...members.filter((m) => m !== rep)];
    const sources: SourceRef[] = [];
    const seenSource = new Set<string>();
    const itemIds: string[] = [];
    for (const m of ordered) {
      const key = `${m.sourceName}\u0000${m.item.url}`;
      if (!seenSource.has(key)) {
        seenSource.add(key);
        sources.push({ name: m.sourceName, url: m.item.url });
      }
      if (!itemIds.includes(m.item.id)) itemIds.push(m.item.id);
    }
    return {
      id: `g:${rep.item.id}`,
      topic: rep.topic,
      kind: rep.kind,
      title: rep.item.title.trim(),
      url: rep.item.url,
      published: rep.item.published,
      firstSeen: today,
      sources,
      itemIds,
      summary: null,
      relevance: null,
      important: false,
      relevanceBy: null,
    };
  });
  // 최근 글이 앞에 오도록
  return groups.sort((a, b) => b.published.localeCompare(a.published) || kindRank(a.kind) - kindRank(b.kind));
}
