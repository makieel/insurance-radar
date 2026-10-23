import type { Config } from '../config.ts';
import type { FetchLike } from '../lib/http.ts';
import type { PdfBudget } from '../lib/pdf.ts';
import type { RateRow, RawItem, SourceId } from '../schema.ts';

export interface CollectCtx {
  fetch: FetchLike;
  now: Date;
  /** 오늘 KST 날짜 YYYY-MM-DD */
  date: string;
  config: Config;
  /** 첫 실행 채우기: true면 목록을 config.limits.backfillPages쪽까지(또는 backfillDays일치까지) 읽는다 */
  backfill: boolean;
  /** 이미 본 글 id. 상세 페이지·첨부는 처음 보는 글만 받는다 */
  seen: Set<string>;
  /** 처음 보는 글의 본문 텍스트를 넘긴다(PDF 텍스트 포함). 저장소에 커밋하지 않는 임시 저장소로 간다 */
  putBody(id: string, text: string): void;
  /** 하루 PDF 첨부 예산(모든 수집기가 함께 씀). fetchPdfText에 넘긴다 */
  pdfBudget: PdfBudget;
}

export interface CollectResult {
  items: RawItem[];
  rates?: RateRow[];
  /** 대체 경로를 썼을 때 화면에 보여 줄 안내 */
  note?: string | null;
}

export interface Collector {
  id: SourceId;
  run(ctx: CollectCtx): Promise<CollectResult>;
}
