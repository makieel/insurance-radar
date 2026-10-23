import { extractText, getDocumentProxy } from 'unpdf';
import { USER_AGENT, type FetchLike } from './http.ts';

/** PDF 바이트에서 글자만 뽑는다. 쪽을 이어 붙이고 공백을 하나로 줄인다. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return String(text).replace(/\s+/g, ' ').trim();
}

/** 하루 받는 PDF 수를 세는 공용 예산. CollectCtx.pdfBudget으로 수집기에 넘어간다. */
export interface PdfBudget {
  left: number;
  maxBytes: number;
}

/**
 * PDF 첨부를 받아 글자를 뽑는다. 예산이 없거나, 크기가 상한을 넘거나, 실패하면 null.
 * 실패해도 수집은 계속해야 하므로 예외를 던지지 않는다.
 */
export async function fetchPdfText(url: string, budget: PdfBudget, opts: { fetch?: FetchLike; headers?: Record<string, string> } = {}): Promise<string | null> {
  if (budget.left <= 0) return null;
  budget.left--;
  try {
    const res = await (opts.fetch ?? fetch)(url, { headers: { 'User-Agent': USER_AGENT, ...opts.headers }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > budget.maxBytes) return null;
    const text = await pdfText(buf);
    return text.length >= 40 ? text : null;
  } catch {
    return null;
  }
}
