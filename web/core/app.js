// 시작점: 데이터를 불러오고 라이트·다크 모드를 정한 뒤 띠 테마로 그린다.
import { loadLatest } from './data.js';
import { createModeController } from './mode.js';
import { render } from '../themes/band/render.js';

const root = document.getElementById('root');
const FAIL = '<p class="loadfail">데이터를 불러오지 못했습니다</p>';

// 저장소가 막힌 브라우저는 localStorage에 접근만 해도 예외가 난다.
function storageOrNull() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function main() {
  let data;
  try {
    data = await loadLatest();
  } catch (err) {
    console.error(err);
    root.innerHTML = FAIL;
    return;
  }
  const mode = createModeController({ root: document.documentElement, storage: storageOrNull() });
  try {
    render(root, data, {
      toggleMode: () => mode.toggle(),
      get mode() {
        return mode.get();
      },
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = FAIL;
  }
}

main();
