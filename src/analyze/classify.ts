import type { Config } from '../config.ts';
import type { Category, SourceKind, Topic } from '../schema.ts';

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => w && text.includes(w));
}

function countIn(text: string, words: string[]): number {
  return words.filter((w) => w && text.includes(w)).length;
}

/** 우선순위(동점이면 앞이 이긴다) */
const ORDER: Category[] = ['auto', 'medical', 'life', 'general'];

export function classify(
  input: { title: string; hints: string[]; body: string | null; kind: SourceKind },
  kw: Config['keywords'],
): Topic {
  const { title, hints, kind } = input;
  const body = input.body ?? '';
  const hintText = hints.join(' ');

  if (hasAny(title, kw.exclude) || hasAny(hintText, kw.exclude)) return 'exclude';
  if (kind === 'press' && !hasAny(`${title} ${body.slice(0, 300)}`, kw.insurance)) return 'exclude';
  if (hasAny(title, kw.industry) && !hasAny(title, [...kw.auto, ...kw.medical, ...kw.life])) return 'industry';

  const head = body.slice(0, 500);
  let best: Category = 'general';
  let bestScore = 0;
  for (const cat of ORDER) {
    const words = kw[cat];
    const score = countIn(title, words) * 3 + hints.reduce((n, h) => n + countIn(h, words), 0) * 2 + countIn(head, words);
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}
