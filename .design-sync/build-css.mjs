// design-sync pre-build: assembles the stylesheet the converter ships as _ds_bundle.css.
// The app loads Archivo through a <link> in frontend/index.html, which no CSS scrape can see,
// so the Google Fonts import is prepended here ahead of the app's own App.css (tokens + classes).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(join(here, '../frontend/src/App.css'), 'utf8');
const fontImport = '@import url("https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap");\n';
const out = join(here, '.cache/ds-styles.css');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, fontImport + '\n' + appCss);
console.error(`wrote ${out} (${(appCss.length / 1024).toFixed(0)} KB from frontend/src/App.css)`);
