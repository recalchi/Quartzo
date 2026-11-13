// Shell desktop do Quartzo (Windows/macOS/Linux).
// Serve o build web pelo protocolo seguro quartzo:// — assim IndexedDB,
// Firebase Auth e Firestore funcionam como em um site https.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'quartzo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    backgroundColor: '#141019',
    title: 'Quartzo',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.loadURL('quartzo://app/index.html');

  // Links externos abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('quartzo://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();

app.on('second-instance', () => {
  const [w] = BrowserWindow.getAllWindows();
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

app.whenReady().then(() => {
  protocol.handle('quartzo', (req) => {
    const { pathname } = new URL(req.url);
    const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    const file = path.join(DIST, safe || 'index.html');
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
