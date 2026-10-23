// 화면 데이터 web/data/latest.json을 불러온다. 매일 바뀌므로 캐시를 피한다.
export async function loadLatest(fetchFn = fetch) {
  const res = await fetchFn(`./data/latest.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== 'object') throw new Error('latest.json 형식 오류');
  return data;
}
