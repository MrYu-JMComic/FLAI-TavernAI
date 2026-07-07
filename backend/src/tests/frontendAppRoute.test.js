import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: appScript, template: appTemplate } = readVueBlocks('frontend/src/App.vue', ['script', 'template']);
const routerSource = readRepoText('frontend/src/router.js');

test('App delegates hash routes to vue-router while preserving route props', () => {
  assert.match(
    appScript,
    /import \{ RouterView, useRoute, useRouter \} from 'vue-router';/
  );
  assert.match(
    appScript,
    /const router = useRouter\(\);\s*const vueRoute = useRoute\(\);/
  );
  assert.match(
    appScript,
    /onMounted\(async \(\) => \{[\s\S]*await router\.isReady\(\);[\s\S]*await refreshSession\(\);[\s\S]*\}\);/
  );
  assert.match(
    appScript,
    /const route = computed\(\(\) => normalizeAppRoute\(vueRoute\)\);/
  );
  assert.match(
    appScript,
    /const routeKey = computed\(\(\) => getRouteKey\(route\.value\)\);/
  );
  assert.match(
    appScript,
    /function navigate\(name, params = \{\}\) {\s*router\.push\(\{ name, params \}\)\.catch\(\(error\) => \{[\s\S]*recordFrontendDiagnostic\('app\.router\.navigate', error, \{ name \}\);[\s\S]*\}\);[\s\S]*}/
  );
  assert.match(
    appScript,
    /function getRouteKey\(value\) {\s*return `\$\{value\?\.name \|\| 'home'\}:\$\{value\?\.params\?\.id \|\| ''\}`;\s*}/
  );
  assert.match(appTemplate, /<RouterView v-else v-slot="\{ Component \}">/);
  assert.doesNotMatch(appScript, /function parseRoute\(/);
  assert.doesNotMatch(appScript, /window\.addEventListener\('hashchange'/);
});

test('router module keeps the legacy hash URL shape with named routes', () => {
  assert.match(routerSource, /createWebHashHistory\(\)/);
  assert.doesNotMatch(routerSource, /defineAsyncComponent/);
  assert.match(routerSource, /component: \(\) => import\('\.\/views\/HomeView\.vue'\)/);
  assert.match(routerSource, /path: '\/',\s*name: 'home'/);
  assert.match(routerSource, /path: '\/login',\s*name: 'login'/);
  assert.match(routerSource, /path: '\/register',\s*name: 'register'/);
  assert.match(routerSource, /path: '\/settings',\s*name: 'settings'/);
  assert.match(routerSource, /path: '\/extensions',\s*name: 'extensions'/);
  assert.match(routerSource, /path: '\/characters\/new',\s*name: 'characterNew'/);
  assert.match(routerSource, /path: '\/characters\/:id\/edit',\s*name: 'characterEdit'/);
  assert.match(routerSource, /path: '\/chat\/:id',\s*name: 'chat'/);
  assert.match(routerSource, /path: '\/world-books',\s*name: 'worldBooks'/);
  assert.match(routerSource, /path: '\/world-books\/:id',\s*name: 'worldBookDetail'/);
  assert.match(routerSource, /path: '\/presets',\s*name: 'presets'/);
  assert.match(routerSource, /path: '\/:pathMatch\(\.\*\)\*',\s*redirect: \{ name: 'home' \}/);
});
