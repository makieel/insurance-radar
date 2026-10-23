import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { SourceId, SourceKind } from './schema.ts';

export const SourceConfig = z.object({
  id: SourceId,
  name: z.string(),
  kind: SourceKind,
  enabled: z.boolean(),
  /** 필요한 비밀 키의 환경변수 이름들. 하나라도 없으면 "꺼짐"으로 건너뛴다 */
  keyEnv: z.array(z.string()).default([]),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

export const ConfigSchema = z.object({
  siteUrl: z.string(),
  sources: z.array(SourceConfig),
  /** 분류 키워드. 제목·힌트·본문 앞부분에서 찾는다 */
  keywords: z.object({
    auto: z.array(z.string()),
    medical: z.array(z.string()),
    life: z.array(z.string()),
    general: z.array(z.string()),
    industry: z.array(z.string()),
    exclude: z.array(z.string()),
    /** 하나도 없으면 보험 무관 소식으로 보고 버린다(전문지 피드의 은행·카드 기사 등) */
    insurance: z.array(z.string()),
    /** 제목에 있고 personal 단어가 없으면 아예 버린다(실적 점유율, 인사, 행사 등) */
    noise: z.array(z.string()),
    /** 개인(가입자·가족) 관련 신호. 관련도 규칙과 noise 구제에 쓴다 */
    personal: z.array(z.string()),
  }),
  limits: z.object({
    /** 하루 AI 호출 상한(요약 + 변경 판정) */
    aiCallsPerDay: z.number().int(),
    /** 하루 요약 개수 상한 */
    summariesPerDay: z.number().int(),
    /** 첫 실행 채우기 범위 */
    backfillDays: z.number().int(),
    backfillPages: z.number().int(),
    /** 하루 받는 PDF 첨부 수와 크기 상한 */
    pdfPerDay: z.number().int(),
    pdfMaxBytes: z.number().int(),
  }),
  ai: z.object({
    baseUrl: z.string(),
    keyEnv: z.string(),
    models: z.array(z.string()).min(1),
    timeoutMs: z.number().int(),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_PATH = new URL('../config.json', import.meta.url);

export function loadConfig(path?: string): Config {
  const raw = JSON.parse(readFileSync(path ?? DEFAULT_PATH, 'utf8'));
  return ConfigSchema.parse(raw);
}
