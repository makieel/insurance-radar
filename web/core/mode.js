// 라이트/다크 모드. 첫 방문은 밝은 모드이고, 고른 값은 저장해 다음 방문에도 유지한다.
// 저장소가 막혀 있어도 동작해야 한다.
export const MODE_KEY = 'ir-mode';

export function initialMode(storage) {
  try {
    const v = storage?.getItem(MODE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // 저장소 접근 불가: 밝은 모드로 연다.
  }
  return 'light';
}

export function createModeController({ root, storage }) {
  let mode = initialMode(storage);
  root.dataset.mode = mode;
  return {
    get: () => mode,
    toggle() {
      mode = mode === 'dark' ? 'light' : 'dark';
      root.dataset.mode = mode;
      try {
        storage?.setItem(MODE_KEY, mode);
      } catch {
        // 저장 실패는 무시한다.
      }
      return mode;
    },
  };
}
