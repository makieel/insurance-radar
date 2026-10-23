import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: name => name === 'entry' || name === 'link',
});

/** Text of a node that may be a string, number, or {#text, @_attr} object. */
export function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'object') return textOf((node as Record<string, unknown>)['#text']);
  return String(node).replace(/\s+/g, ' ').trim();
}

/** Atom `<entry>` elements as an array (empty if none). */
export function atomEntries(xml: string): any[] {
  const entries = parser.parse(xml)?.feed?.entry;
  return Array.isArray(entries) ? entries : [];
}

/** href of the first link with rel alternate (or no rel). */
export function linkHref(links: unknown): string {
  const arr = Array.isArray(links) ? links : links ? [links] : [];
  const pick = arr.find((l: any) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? arr[0];
  return typeof pick?.['@_href'] === 'string' ? pick['@_href'] : '';
}
