import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appName = 'FLAI TavernAI';

let mainWindow = null;
let splashWindow = null;
let errorWindow = null;
let backendProcess = null;
let frontendServer = null;
let backendLogStream = null;
let isQuitting = false;
let appIconPath = '';

app.setName(appName);
app.setAppUserModelId('local.flai.tavernai');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);

  app.whenReady().then(bootstrap).catch((error) => {
    showFatalError('Desktop startup failed', error);
  });
}

function focusExistingWindow() {
  const targetWindow = mainWindow || splashWindow || errorWindow;
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  targetWindow.show();
  targetWindow.focus();
}

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
  stopFrontendServer();
});

app.on('window-all-closed', () => {
  app.quit();
});

async function bootstrap() {
  const resourcesRoot = getResourcesRoot();
  const resourceBackendDir = path.join(resourcesRoot, 'backend');
  const frontendDir = path.join(resourcesRoot, 'frontend');
  const resourceSharedDir = path.join(resourcesRoot, 'shared');
  const nodeExe = getNodeExecutable(resourcesRoot);
  appIconPath = getAppIconPath(resourcesRoot);

  Menu.setApplicationMenu(null);
  createSplashWindow();

  ensureRequiredPath(resourceBackendDir, 'Packaged backend files are missing.');
  ensureRequiredPath(frontendDir, 'Packaged frontend files are missing.');
  ensureRequiredPath(resourceSharedDir, 'Packaged shared runtime files are missing.');
  ensureRequiredPath(nodeExe, 'Packaged Node runtime is missing.');

  const runtimeBackendDir = syncRuntimeBackend(resourceBackendDir);
  syncRuntimeShared(resourceSharedDir);
  const backendPort = await findAvailablePort(readPort(process.env.FLAI_DESKTOP_BACKEND_PORT, 3001));
  const frontendPort = await findAvailablePort(readPort(process.env.FLAI_DESKTOP_FRONTEND_PORT, 0));
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

  frontendServer = await startFrontendServer({
    frontendDir,
    backendPort,
    frontendPort
  });

  startBackend({
    nodeExe,
    backendDir: runtimeBackendDir,
    backendPort,
    frontendOrigin
  });

  await waitForBackend(`http://127.0.0.1:${backendPort}/api/health`, 30000);
  createMainWindow(`${frontendOrigin}/#/`);
}

function getResourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(currentDir, '..', '..', 'dist', 'windows-app');
}

function getNodeExecutable(resourcesRoot) {
  return path.join(resourcesRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
}

function getAppIconPath(resourcesRoot) {
  const iconPaths = [
    path.join(resourcesRoot, 'frontend', 'icons', 'icon-512.png'),
    path.join(resourcesRoot, 'frontend', 'favicon.ico')
  ];
  for (const iconPath of iconPaths) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }
  return '';
}

function ensureRequiredPath(targetPath, message) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${message}\nMissing: ${targetPath}`);
  }
}

function readPort(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

function syncRuntimeBackend(resourceBackendDir) {
  const userDataDir = app.getPath('userData');
  const runtimeBackendDir = path.join(userDataDir, 'backend');
  const sourceMarkerPath = path.join(resourceBackendDir, '.flai-runtime-source.json');
  const runtimeMarkerPath = path.join(runtimeBackendDir, '.flai-runtime-source.json');
  const sourceMarker = readTextFile(sourceMarkerPath);
  const runtimeMarker = readTextFile(runtimeMarkerPath);

  fs.mkdirSync(runtimeBackendDir, { recursive: true });
  if (!sourceMarker || sourceMarker !== runtimeMarker) {
    copyDirectory(resourceBackendDir, runtimeBackendDir, shouldSkipRuntimeCopyEntry);
  }
  return runtimeBackendDir;
}

function syncRuntimeShared(resourceSharedDir) {
  const userDataDir = app.getPath('userData');
  const runtimeSharedDir = path.join(userDataDir, 'shared');
  const sourceMarkerPath = path.join(resourceSharedDir, '.flai-runtime-source.json');
  const runtimeMarkerPath = path.join(runtimeSharedDir, '.flai-runtime-source.json');
  const sourceMarker = readTextFile(sourceMarkerPath);
  const runtimeMarker = readTextFile(runtimeMarkerPath);

  fs.mkdirSync(runtimeSharedDir, { recursive: true });
  if (!sourceMarker || sourceMarker !== runtimeMarker) {
    copyDirectory(resourceSharedDir, runtimeSharedDir, () => false);
  }
  return runtimeSharedDir;
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function shouldSkipRuntimeCopyEntry(sourceRoot, entryPath) {
  const relativePath = path.relative(sourceRoot, entryPath);
  const topLevel = relativePath.split(path.sep)[0].toLowerCase();
  if (topLevel === 'data' || topLevel === 'uploads' || topLevel === 'logs') {
    return true;
  }

  const baseName = path.basename(entryPath).toLowerCase();
  return baseName === '.env'
    || baseName.startsWith('.env.')
    || baseName.endsWith('.log');
}

function copyDirectory(sourceDir, destinationDir, shouldSkip) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (shouldSkip(sourceDir, sourcePath)) {
      continue;
    }

    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath, (_childRoot, childPath) => shouldSkip(sourceDir, childPath));
      continue;
    }

    if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function startBackend({ nodeExe, backendDir, backendPort, frontendOrigin }) {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  backendLogStream = fs.createWriteStream(path.join(logsDir, 'backend.log'), { flags: 'a' });
  backendLogStream.write(`\n[desktop] Starting backend at ${new Date().toISOString()}\n`);

  const backendEntry = path.join(backendDir, 'src', 'server.js');
  backendProcess = spawn(nodeExe, [backendEntry], {
    cwd: backendDir,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'desktop',
      PORT: String(backendPort),
      CLIENT_ORIGIN: frontendOrigin,
      ALLOW_PRIVATE_NETWORK_ORIGINS: 'false',
      FLAI_DESKTOP: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', (chunk) => {
    backendLogStream.write(chunk);
  });
  backendProcess.stderr.on('data', (chunk) => {
    backendLogStream.write(chunk);
  });
  backendProcess.on('exit', (code, signal) => {
    backendLogStream?.write(`[desktop] Backend exited with code=${code} signal=${signal}\n`);
    if (!isQuitting) {
      showFatalError('Backend stopped', new Error(`The backend process exited. See ${path.join(logsDir, 'backend.log')}`));
    }
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
  backendLogStream?.end();
  backendLogStream = null;
}

function startFrontendServer({ frontendDir, backendPort, frontendPort }) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${frontendPort}`);
    if (
      requestUrl.pathname.startsWith('/api/')
      || requestUrl.pathname === '/api'
      || requestUrl.pathname.startsWith('/uploads/')
      || requestUrl.pathname === '/uploads'
    ) {
      proxyRequest(request, response, backendPort);
      return;
    }
    serveStaticFile(frontendDir, requestUrl.pathname, response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(frontendPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function stopFrontendServer() {
  if (frontendServer) {
    frontendServer.close();
  }
  frontendServer = null;
}

function proxyRequest(clientRequest, clientResponse, backendPort) {
  const headers = { ...clientRequest.headers, host: `127.0.0.1:${backendPort}` };
  delete headers.connection;

  const proxy = http.request({
    hostname: '127.0.0.1',
    port: backendPort,
    path: clientRequest.url,
    method: clientRequest.method,
    headers
  }, (backendResponse) => {
    clientResponse.writeHead(backendResponse.statusCode || 502, backendResponse.headers);
    backendResponse.pipe(clientResponse);
  });

  proxy.on('error', () => {
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    clientResponse.end(JSON.stringify({ error: 'Desktop backend is not available' }));
  });

  clientRequest.pipe(proxy);
}

function serveStaticFile(frontendDir, requestPath, response) {
  const frontendRoot = path.resolve(frontendDir);
  const decodedPath = safeDecodePath(requestPath);
  if (!decodedPath) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  const safePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  let filePath = path.resolve(frontendRoot, safePath);

  if (!isPathInside(frontendRoot, filePath)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(frontendRoot, 'index.html');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypeForPath(filePath),
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable'
    });
    response.end(content);
  });
}

function safeDecodePath(requestPath) {
  try {
    return decodeURIComponent(requestPath || '/');
  } catch {
    return '';
  }
}

function isPathInside(rootDir, targetPath) {
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp'
  };
  return types[extension] || 'application/octet-stream';
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141210',
    icon: appIconPath || undefined,
    title: appName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    shell.openExternal(nextUrl);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    closeSplashWindow();
    mainWindow.setMenuBarVisibility(false);
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(url);
}

function createSplashWindow() {
  if (splashWindow) return;
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#151311',
    icon: appIconPath || undefined,
    title: appName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  splashWindow.loadURL(dataUrlForHtml(splashHtml()));
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', (error) => {
      if (preferredPort > 0) {
        findAvailablePort(0).then(resolve, reject);
        return;
      }
      reject(error);
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
  });
}

function waitForBackend(healthUrl, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(healthUrl, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === 200 && body.includes('"ok":true')) {
            resolve();
            return;
          }
          retry();
        });
      }).on('error', retry);
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Backend did not become ready within 30 seconds.'));
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

function showFatalError(title, error) {
  const message = error?.stack || error?.message || String(error);
  if (!app.isReady()) {
    dialog.showErrorBox(`${appName}: ${title}`, message);
    app.quit();
    return;
  }

  closeSplashWindow();
  stopBackend();
  stopFrontendServer();
  createErrorWindow(title, message);
}

function createErrorWindow(title, message) {
  if (errorWindow && !errorWindow.isDestroyed()) {
    errorWindow.focus();
    return;
  }

  const logsDir = path.join(app.getPath('userData'), 'logs');
  errorWindow = new BrowserWindow({
    width: 680,
    height: 460,
    minWidth: 560,
    minHeight: 380,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#151311',
    icon: appIconPath || undefined,
    title: `${appName} - ${title}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  errorWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file:')) {
      shell.openPath(fileURLToPath(url));
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  errorWindow.once('ready-to-show', () => {
    errorWindow?.setMenuBarVisibility(false);
    errorWindow?.show();
  });
  errorWindow.on('closed', () => {
    errorWindow = null;
  });
  errorWindow.loadURL(dataUrlForHtml(errorHtml({ title, message, logsDir })));
}

function dataUrlForHtml(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function splashHtml() {
  const iconUrl = appIconPath ? pathToFileURL(appIconPath).href : '';
  const iconMarkup = iconUrl ? `<img class="icon" src="${escapeHtml(iconUrl)}" alt="" />` : '<div class="icon fallback"></div>';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #f4efe5;
      background: #151311;
      font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    .shell {
      width: 100%;
      height: 100vh;
      display: grid;
      place-items: center;
      padding: 34px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(135deg, #171411, #24211d 54%, #101316);
    }
    .stack { display: grid; justify-items: center; gap: 16px; text-align: center; }
    .icon {
      width: 76px;
      height: 76px;
      border-radius: 18px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32);
    }
    .fallback { background: linear-gradient(135deg, #d85635, #2f786d); }
    h1 { margin: 0; font-size: 24px; font-weight: 700; }
    p { margin: 0; color: #cfc6b8; font-size: 14px; }
    .bar {
      width: 210px;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
    }
    .bar::before {
      content: "";
      display: block;
      width: 44%;
      height: 100%;
      border-radius: inherit;
      background: #e07046;
      animation: load 1.1s ease-in-out infinite;
    }
    @keyframes load {
      0% { transform: translateX(-105%); }
      100% { transform: translateX(240%); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="stack">
      ${iconMarkup}
      <h1>${escapeHtml(appName)}</h1>
      <p>Starting the local workspace</p>
      <div class="bar" aria-hidden="true"></div>
    </section>
  </main>
</body>
</html>`;
}

function errorHtml({ title, message, logsDir }) {
  const logsUrl = pathToFileURL(logsDir).href;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: #f4efe5;
      background: #151311;
      font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main { padding: 34px; display: grid; gap: 18px; }
    .badge {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      color: #fff;
      background: #c84d35;
      font-size: 28px;
      font-weight: 700;
    }
    h1 { margin: 0; font-size: 24px; }
    p { margin: 0; color: #d8cec0; line-height: 1.6; }
    code {
      display: block;
      max-height: 150px;
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      color: #f7ead7;
      background: rgba(255, 255, 255, 0.08);
      white-space: pre-wrap;
      word-break: break-word;
    }
    a {
      width: max-content;
      color: #151311;
      padding: 10px 14px;
      border-radius: 6px;
      text-decoration: none;
      background: #f1c27d;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">!</div>
    <h1>${escapeHtml(title)}</h1>
    <p>The local backend stopped before the desktop app could finish starting.</p>
    <a href="${escapeHtml(logsUrl)}" target="_blank">Open Log Folder</a>
    <code>${escapeHtml(message)}</code>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
