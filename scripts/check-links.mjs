// Checks that every documentation link in src/core/fields/links.ts still resolves, including
// the #anchor. Run `npm run build` first. Needs network access; not part of CI.
import { allDocsLinks } from '../dist/core/fields/links.js';

let failed = 0;
for (const link of allDocsLinks()) {
  const [url, anchor] = link.split('#');
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const html = res.ok ? await res.text() : '';
    const ok =
      res.ok && (!anchor || html.includes(`id=${anchor}`) || html.includes(`id="${anchor}"`));
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${res.status} ${link}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${link} (${err instanceof Error ? err.message : err})`);
  }
}
process.exitCode = failed ? 1 : 0;
