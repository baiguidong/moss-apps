import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { compile } from 'tailwindcss';

const root = path.dirname(fileURLToPath(import.meta.url));
export const SETTINGS_ROUTE = '#/moss-settings';

export async function buildAppSettings(appRoot, { outputDir, html: sourceHtml } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(appRoot, 'app.moss.json'), 'utf8'));
  const view = manifest.contributes?.views?.find(item => item.route === SETTINGS_ROUTE);
  if (!view || !manifest.contributes?.settings?.some(item => item.viewId === view.id)) throw new Error('App must declare its shared settings view before building.');
  const target = outputDir || path.dirname(path.join(appRoot, manifest.ui.entry));
  await fs.mkdir(target, { recursive: true });
  const primary = manifest.contributes.views.find(item => item.id === manifest.navigation?.viewId);
  const options = { id: manifest.id, name: manifest.id, title: manifest.displayName, enabled: true, grants: [],
    primaryRoute: primary?.route || '#/', toolSelection: manifest.toolSelection || 'app',
    mcp: manifest.host?.protocols?.includes('moss.mcp/v1') || false, tools: manifest.contributes.tools || [],
  };
  const result = spawnSync('bun', ['build', path.join(root, 'src/main.tsx'), '--target=browser', '--format=esm', '--minify',
    '--define', `__APP_SETTINGS__=${JSON.stringify(options)}`, '--outfile', path.join(target, 'app-settings.js')], { cwd: appRoot, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error('Shared App settings build failed');
  const require = createRequire(import.meta.url);
  const theme = await fs.readFile(require.resolve('tailwindcss/theme.css'), 'utf8');
  const source = (await Promise.all((await fs.readdir(path.join(root, 'src'))).filter(name => name.endsWith('.tsx')).map(name => fs.readFile(path.join(root, 'src', name), 'utf8')))).join('\n');
  const candidates = [...new Set(source.match(/[a-zA-Z0-9][a-zA-Z0-9:./%_,()\-[\]]*/g))];
  const compiler = await compile(`${theme}\n@theme inline {
    --color-background: var(--background, #fafcf7); --color-foreground: var(--foreground, #1d2922);
    --color-muted: var(--muted, #edf2ed); --color-muted-foreground: var(--muted-foreground, #65716a);
    --color-primary: var(--primary, #199b54); --color-primary-foreground: var(--primary-foreground, white);
    --color-border: var(--border, #d8dfd8); --color-destructive: var(--destructive, #bd3535);
  }\n@tailwind utilities;`);
  const utilities = compiler.build(candidates);
  // Chromium does not register @property initial values from shadow stylesheets.
  const defaults = [...utilities.matchAll(/@property\s+(--[\w-]+)\s*\{[^}]*?initial-value:\s*([^;}]+)/g)].map(([, name, value]) => `${name}:${value.trim()}`).join(';');
  const reset = ':host{position:fixed;inset:0;z-index:2147483646;overflow:auto;background:var(--background,#fafcf7);color:var(--foreground,#1d2922);font:14px/1.5 system-ui,sans-serif;text-align:left}*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid}h1,h2,h3,h4,h5,p,dl,dd{margin:0}button,input,select{font:inherit}button{cursor:pointer;background:transparent}button:disabled{cursor:default}fieldset{padding:0;margin:0;min-width:0}input[type=radio],input[type=checkbox]{margin:0;width:16px;height:16px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--primary,#199b54);outline-offset:2px}';
  await fs.writeFile(path.join(target, 'app-settings.css'), `${reset}\n:host,*,::before,::after{${defaults}}\n${utilities}`);
  const entry = path.join(appRoot, manifest.ui.entry);
  let html = sourceHtml ?? await fs.readFile(entry, 'utf8');
  if (!html.includes('src="./app-settings.js"')) html = html.replace('</body>', '<script type="module" src="./app-settings.js"></script></body>');
  if (sourceHtml === undefined) await fs.writeFile(entry, html);
  return html;
}

/** Vite development uses the same bundle and metadata as packaged Apps. */
export function appSettingsPlugin(appRoot) {
  appRoot = appRoot instanceof URL ? fileURLToPath(appRoot) : appRoot;
  let outputDir, preparation;
  return {
    name: 'moss-app-settings', apply: 'serve',
    configResolved(config) { outputDir = path.join(config.cacheDir, 'moss-app-settings'); },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const name = request.url?.split('?', 1)[0]?.split('/').pop();
        if (!['app-settings.js', 'app-settings.css'].includes(name)) return next();
        try {
          await preparation;
          response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
          response.end(await fs.readFile(path.join(outputDir, name)));
        } catch (error) { next(error); }
      });
    },
    async transformIndexHtml(html) {
      preparation ??= buildAppSettings(appRoot, { outputDir, html });
      await preparation;
      return html.replace('</body>', '<script type="module" src="./app-settings.js"></script></body>');
    },
  };
}
