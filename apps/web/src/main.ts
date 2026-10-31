import {
  RuleError,
  checkManifest,
  diffManifests,
  FixPolicyError,
  explainManifest,
  fixManifest,
  loadBundledRules,
  parseFixPolicy,
  parseCrds,
  parseRules,
  unifiedDiff,
} from '@k8s-manifestlens/core';
import type { FixPolicy, FixRisk, Rule } from '@k8s-manifestlens/core';
import { inject } from '@vercel/analytics';
import './style.css';
import { fetchCrdText, toRawUrl } from './crd-url.js';
import { describeMeta, enhanceTextarea, manifestInfo } from './editor.js';
import type { Editor } from './editor.js';
import {
  customResourceExample,
  exampleRules,
  examples,
  fixExamples,
  quickStarts,
} from './examples.js';
import { initTheme } from './theme.js';
import {
  createView,
  renderCheck,
  renderDiff,
  renderExplain,
  renderOverview,
  renderSuggestions,
  renderFix,
  renderMessage,
} from './render.js';
import type { JumpTarget } from './render.js';

type Tab = 'explain' | 'check' | 'diff' | 'fix';
const TABS: Tab[] = ['explain', 'check', 'diff', 'fix'];

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};
const input = (id: string): HTMLTextAreaElement => $<HTMLTextAreaElement>(id);

inject();

const bundled = loadBundledRules();

/** Show a message under a text box, or hide the box's error line when there is none. */
function setError(id: string, message: string | undefined): void {
  const el = $(id);
  el.hidden = message === undefined;
  el.textContent = message ?? '';
}

/** Which rule ids came from where, so a finding can say whether it is built in, yours, or from a CRD. */
let customRuleIds = new Set<string>();
const bundledIds = new Set(bundled.map((r) => r.id));
/** CRD schema findings are made by the checker (`crd-<code>`), not by a rule anyone wrote. */
const originOf = (id: string): string =>
  bundledIds.has(id)
    ? 'Built-in rule'
    : customRuleIds.has(id) || !id.startsWith('crd-')
      ? 'Your rule'
      : 'Schema check (from your CRD)';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function setCount(id: string, text: string, bad = false): void {
  const node = $(id);
  node.textContent = text;
  node.classList.toggle('bad', bad);
}

/**
 * Bundled rules plus any the user pasted, and the schemas of any pasted CustomResourceDefinitions.
 * Shows the error under the box that caused it and leaves that box's contribution out.
 */
function currentRules(): Rule[] {
  const rules = [...bundled];
  const ids = new Set(rules.map((r) => r.id));
  customRuleIds = new Set();
  const add = (
    boxId: string,
    errorId: string,
    countId: string,
    noun: string,
    parse: () => Rule[],
  ): void => {
    setError(errorId, undefined);
    setCount(countId, `0 ${noun}s`);
    if (input(boxId).value.trim() === '') return;
    try {
      const extra = parse();
      const clash = extra.find((r) => ids.has(r.id));
      if (clash) throw new RuleError(`Rule id "${clash.id}" is already used by a built-in rule.`);
      for (const r of extra) {
        ids.add(r.id);
        if (boxId === 'extra-rules') customRuleIds.add(r.id);
      }
      rules.push(...extra);
      setCount(countId, plural(extra.length, noun));
    } catch (err) {
      setError(errorId, err instanceof Error ? err.message : String(err));
      setCount(countId, 'has an error', true);
    }
  };
  add('extra-rules', 'rules-error', 'rules-count', 'rule', () =>
    parseRules(input('extra-rules').value, 'your rules'),
  );
  add('extra-crds', 'crds-error', 'crds-count', 'custom kind', () =>
    parseCrds(input('extra-crds').value, 'your CRDs'),
  );
  return rules;
}

const editors = new Map<string, Editor>();

/** Select a line of a text box and bring it into view, so a result row can point at its source. */
function selectLine(id: string, line: number, focus = true): void {
  editors.get(id)?.select(line, focus);
}

const jumpers: Record<Tab, (target: JumpTarget, line: number, focus?: boolean) => void> = {
  explain: (_t, line, f) => selectLine('explain-input', line, f),
  check: (_t, line, f) => selectLine('check-input', line, f),
  diff: (target, line, f) => selectLine(target === 'old' ? 'diff-old' : 'diff-new', line, f),
  fix: (_t, line, f) => selectLine('fix-input', line, f),
};
const views = {
  explain: createView(jumpers.explain),
  explainFindings: createView(jumpers.explain),
  check: createView(jumpers.check),
  diff: createView(jumpers.diff),
  fix: createView(jumpers.fix),
};
views.explainFindings.origin = originOf;
views.check.origin = originOf;
views.check.group = 'severity';
views.check.regroup = () => update('check');
views.explainFindings.group = 'severity';
views.explainFindings.regroup = () => update('explain');
views.diff.origin = originOf;

function show(output: HTMLElement, content: HTMLElement): void {
  // Keep the reader's place while they type: re-rendering would otherwise jump to the top.
  const top = output.scrollTop;
  output.replaceChildren(content);
  output.scrollTop = top;
}

/** The Fix input as it was before the last "Apply to input", so it can be undone. */
let beforeApply: string | undefined;

/** The policy the user typed, or undefined (with the error shown) when it is not valid. */
function currentPolicy(): FixPolicy | undefined {
  const text = input('fix-policy').value;
  const error = $('fix-policy-error');
  error.hidden = true;
  if (text.trim() === '') return undefined;
  try {
    return parseFixPolicy(text, 'your policy');
  } catch (err) {
    error.textContent = err instanceof FixPolicyError ? err.message : String(err);
    error.hidden = false;
    return undefined;
  }
}

/** The Explain tab's right-hand side: line by line, resource overview, findings and suggestions. */
type Section = 'line' | 'overview' | 'findings' | 'suggestions';
let section: Section = 'line';

function explainPanel(
  result: ReturnType<typeof explainManifest>,
  check: ReturnType<typeof checkManifest>,
  fix: ReturnType<typeof fixManifest>,
  source: string,
): HTMLElement {
  const findings = check.documents.flatMap((d) => d.findings);
  const suggestions = fix.applied.length + fix.unfixed.length + fix.skipped.length;
  const sections: { id: Section; label: string; body: HTMLElement }[] = [
    {
      id: 'line',
      label: 'Line by line',
      body: renderExplain(result, source, views.explain, findings),
    },
    {
      id: 'overview',
      label: 'Resource overview',
      body: renderOverview(result, check, views.explain),
    },
    {
      id: 'findings',
      label: `Findings (${findings.length})`,
      body: renderCheck(check, views.explainFindings),
    },
    {
      id: 'suggestions',
      label: `Suggestions (${suggestions})`,
      body: renderSuggestions(fix, views.explain, () => select('fix')),
    },
  ];
  const bar = document.createElement('div');
  bar.className = 'subtabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Explanation sections');
  const root = document.createElement('div');
  const buttons = new Map<Section, HTMLButtonElement>();
  const choose = (id: Section, focus = false): void => {
    section = id;
    for (const sec of sections) {
      const on = sec.id === id;
      const b = buttons.get(sec.id);
      b?.setAttribute('aria-selected', String(on));
      if (b) b.tabIndex = on ? 0 : -1;
      sec.body.hidden = !on;
    }
    if (focus) buttons.get(id)?.focus();
  };
  sections.forEach((sec, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.className = 'subtab';
    b.textContent = sec.label;
    b.addEventListener('click', () => choose(sec.id));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) choose(sections[(i + d + sections.length) % sections.length]?.id ?? 'line', true);
    });
    buttons.set(sec.id, b);
    bar.append(b);
    sec.body.setAttribute('role', 'tabpanel');
    sec.body.classList.add('subpanel');
  });
  root.append(bar, ...sections.map((x) => x.body));
  choose(section);
  return root;
}

function update(tab: Tab): void {
  updateMeta(tab);
  if (tab === 'explain') {
    const source = input('explain-input').value;
    const out = $('explain-output');
    if (source.trim() === '')
      return show(out, emptyState('explain', 'Explain a manifest line by line.'));
    const rules = currentRules();
    const result = explainManifest(source, rules);
    if (result.documents.length === 0)
      return show(out, renderMessage('No Kubernetes documents found.'));
    views.explain.line ??= editors.get('explain-input')?.line();
    show(
      out,
      explainPanel(
        result,
        checkManifest(source, rules),
        fixManifest(source, rules, { maxRisk: 'high' }),
        source,
      ),
    );
  } else if (tab === 'check') {
    const source = input('check-input').value;
    const out = $('check-output');
    if (source.trim() === '')
      return show(out, emptyState('check', 'Check a manifest for risky settings.'));
    const result = checkManifest(source, currentRules());
    show(
      out,
      result.documents.length
        ? renderCheck(result, views.check)
        : renderMessage('No Kubernetes documents found.'),
    );
  } else if (tab === 'fix') {
    const source = input('fix-input').value;
    const out = $('fix-output');
    if (source.trim() === '')
      return show(out, emptyState('fix', 'Preview automatic fixes for a manifest.'));
    if (explainManifest(source).documents.length === 0)
      return show(out, renderMessage('No Kubernetes documents found.'));
    const policy = currentPolicy();
    const result = fixManifest(source, currentRules(), {
      maxRisk: $<HTMLSelectElement>('fix-risk').value as FixRisk,
      ...(policy ? { policy } : {}),
    });
    show(
      out,
      renderFix(
        result,
        unifiedDiff(result.original, result.fixed, 'a/manifest.yaml', 'b/manifest.yaml'),
        {
          copy: (text) => void navigator.clipboard?.writeText(text),
          jump: (line) => selectLine('fix-input', line),
          apply: (text) => {
            beforeApply = input('fix-input').value;
            setManifest(text);
            update('fix');
          },
          ...(beforeApply !== undefined
            ? {
                undo: () => {
                  setManifest(beforeApply ?? '');
                  beforeApply = undefined;
                  update('fix');
                },
              }
            : {}),
        },
      ),
    );
  } else {
    const oldText = input('diff-old').value;
    const newText = input('diff-new').value;
    const out = $('diff-output');
    if (oldText.trim() === '' || newText.trim() === '') {
      return show(
        out,
        emptyState(
          'diff',
          oldText.trim() === '' && newText.trim() === ''
            ? 'Compare two versions of a manifest.'
            : `Add the ${oldText.trim() === '' ? 'old' : 'new'} version to compare.`,
        ),
      );
    }
    show(out, renderDiff(diffManifests(oldText, newText, currentRules()), views.diff));
  }
}

let active: Tab = 'explain';

function select(tab: Tab): void {
  active = tab;
  for (const t of TABS) {
    const selected = t === tab;
    $(`tab-${t}`).setAttribute('aria-selected', String(selected));
    $(`tab-${t}`).tabIndex = selected ? 0 : -1;
    $(`panel-${t}`).hidden = !selected;
  }
  document
    .querySelectorAll<HTMLElement>('[data-hide-on]')
    .forEach((n) => (n.hidden = n.dataset.hideOn === tab));
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  update(tab);
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** Fetch the CRD at the typed URL into the CRD box, or show why that was not possible. */
async function loadCrdFromUrl(): Promise<void> {
  const raw = input('crd-url').value;
  const url = toRawUrl(raw);
  if (!url) {
    setError(
      'crds-error',
      raw.trim() === ''
        ? 'Enter a GitHub link to a CRD file.'
        : 'Only GitHub links work here (github.com or raw.githubusercontent.com, over https). Paste the YAML instead.',
    );
    return;
  }
  const button = $<HTMLButtonElement>('crd-load');
  button.disabled = true;
  try {
    setBox('extra-crds', await fetchCrdText(url));
    setError('crds-error', undefined);
  } catch (err) {
    setError('crds-error', err instanceof Error ? err.message : String(err));
  } finally {
    button.disabled = false;
  }
}

/* ---- shared manifest, editor tools and empty states ---- */

/** Explain, Check and Fix work on the same manifest, so switching tabs never loses it. */
const SHARED = ['explain-input', 'check-input', 'fix-input'];
const DIFF_BOXES = ['diff-old', 'diff-new'];
const META: Record<string, string> = {
  'explain-input': 'explain-meta',
  'check-input': 'check-meta',
  'fix-input': 'fix-meta',
  'diff-old': 'diff-old-meta',
  'diff-new': 'diff-new-meta',
};

function setManifest(text: string): void {
  for (const id of SHARED) {
    input(id).value = text;
    editors.get(id)?.refresh();
  }
}

function setBox(id: string, text: string): void {
  input(id).value = text;
  editors.get(id)?.refresh();
}

/** Text the user did not write: replacing it needs no confirmation. */
const knownTexts = new Set<string>([
  ...Object.values(quickStarts).map((q) => q.text),
  ...Object.values(fixExamples).map((e) => e.text),
  ...Object.values(examples).flatMap((e) => (typeof e === 'string' ? [e] : [e.old, e.new])),
  customResourceExample.text,
  exampleRules,
]);

/** True when overwriting these boxes would throw away something the user typed or pasted. */
function wouldDiscard(ids: string[]): boolean {
  return ids.some((id) => {
    const v = input(id).value;
    return v.trim() !== '' && !knownTexts.has(v);
  });
}

function confirmDiscard(ids: string[], what: string): boolean {
  return !wouldDiscard(ids) || window.confirm(`${what} This replaces what is in the editor.`);
}

function updateMeta(tab: Tab): void {
  for (const id of tab === 'diff' ? DIFF_BOXES : [`${tab}-input`]) {
    const text = input(id).value;
    const info = manifestInfo(text);
    $(META[id] as string).textContent = describeMeta(text, info);
    if (tab !== 'diff') {
      const badge = $('doc-badge');
      badge.hidden = info.documents === 0;
      badge.textContent =
        info.documents === 1 ? '1 document' : `Multi-document (${info.documents})`;
    }
  }
  if (tab === 'diff') $('doc-badge').hidden = true;
}

function toolButton(label: string, tip: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.title = tip;
  return b;
}

/** The row under the header: example, upload, clear and the sample chips. Acts on the open tab. */
function initToolbar(): void {
  $('tb-example').addEventListener('click', () => loadExample(active));
  const file = $<HTMLInputElement>('tb-file');
  $('tb-upload').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    if (!confirmDiscard(SHARED, `Load "${picked.name}"?`)) return;
    // Read in the browser: the file is never sent anywhere.
    void picked.text().then((text) => {
      setManifest(text);
      beforeApply = undefined;
      update(active);
    });
  });
  $('tb-clear').addEventListener('click', () => {
    const ids = active === 'diff' ? DIFF_BOXES : SHARED;
    if (!confirmDiscard(ids, 'Clear the editor?')) return;
    if (active === 'diff') for (const id of DIFF_BOXES) setBox(id, '');
    else setManifest('');
    beforeApply = undefined;
    update(active);
  });

  const samples = $('samples');
  const chip = (label: string, load: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.textContent = label;
    b.title = `Load a sample ${label}`;
    b.addEventListener('click', () => {
      if (!confirmDiscard(SHARED, 'You have a manifest of your own in the editor.')) return;
      load();
      beforeApply = undefined;
      update(active);
    });
    samples.append(b);
  };
  for (const q of Object.values(quickStarts)) chip(q.label, () => setManifest(q.text));
  chip('CRD', () => {
    setManifest(customResourceExample.text);
    if (
      input('extra-crds').value.trim() === '' ||
      window.confirm('Also replace the CRD in the Custom resources box with the sample CRD?')
    ) {
      setBox('extra-crds', customResourceExample.crd);
      const box = document.querySelectorAll<HTMLDetailsElement>('details.rules')[1];
      if (box) box.open = true;
    }
  });

  const help = $('privacy-help');
  help.addEventListener('click', () => {
    const note = $('privacy-note');
    note.hidden = !note.hidden;
    help.setAttribute('aria-expanded', String(!note.hidden));
  });
}

/** An icon-only "copy" button in the corner of each editor. */
function addCopyButtons(): void {
  for (const [id, editor] of editors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy-fab';
    b.title = 'Copy to clipboard';
    b.setAttribute('aria-label', 'Copy to clipboard');
    b.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';
    b.addEventListener('click', () => {
      const done = (label: string): void => {
        b.title = label;
        b.classList.add('done');
        setTimeout(() => {
          b.title = 'Copy to clipboard';
          b.classList.remove('done');
        }, 1500);
      };
      if (!navigator.clipboard) return done('Copy is not available here');
      navigator.clipboard.writeText(input(id).value).then(
        () => done('Copied'),
        () => done('Copy failed'),
      );
    });
    editor.box.parentElement?.append(b);
  }
}

function loadExample(tab: Tab): void {
  const ids = tab === 'diff' ? DIFF_BOXES : SHARED;
  if (!confirmDiscard(ids, 'You have a manifest of your own in the editor.')) return;
  if (tab === 'diff') {
    setBox('diff-old', examples.diff.old);
    setBox('diff-new', examples.diff.new);
  } else {
    setManifest(examples[tab]);
    beforeApply = undefined;
  }
  update(tab);
  $(`${tab}-output`).scrollTop = 0;
}

/** The right-hand panel before any manifest is loaded: say what the tab does and offer a first step. */
function emptyState(tab: Tab, headline: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const h = document.createElement('h2');
  h.textContent = headline;
  const p = document.createElement('p');
  p.textContent =
    tab === 'diff'
      ? 'Paste both versions into the editors to see what applying the change will do.'
      : 'Paste YAML into the editor, or start from an example. Everything is processed in this page.';
  const actions = document.createElement('div');
  actions.className = 'empty-actions';
  const example = toolButton('Load an example', 'Fill the editor with a sample manifest');
  example.classList.add('primary');
  example.addEventListener('click', () => loadExample(tab));
  actions.append(example);
  if (tab !== 'diff') {
    const upload = toolButton('Upload YAML', 'Open a YAML file from your computer');
    upload.addEventListener('click', () =>
      document
        .querySelector<HTMLButtonElement>(`[data-tools="${tab}"] button[title^="Open"]`)
        ?.click(),
    );
    actions.append(upload);
  }
  box.append(h, p, actions);
  return box;
}

/** Drag or use the arrow keys on the divider to change how wide the editor is. */
function initSplitter(): void {
  const root = document.documentElement;
  const set = (pct: number): number => {
    const v = Math.max(25, Math.min(70, pct));
    root.style.setProperty('--split', `${v}%`);
    document
      .querySelectorAll('.splitter')
      .forEach((s) => s.setAttribute('aria-valuenow', String(Math.round(v))));
    return v;
  };
  let value = 41;
  document.querySelectorAll<HTMLElement>('.splitter').forEach((bar) => {
    bar.setAttribute('aria-valuemin', '25');
    bar.setAttribute('aria-valuemax', '70');
    bar.setAttribute('aria-valuenow', String(value));
    bar.addEventListener('pointerdown', (e) => {
      const panel = bar.parentElement as HTMLElement;
      bar.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent): void => {
        const r = panel.getBoundingClientRect();
        value = set(((m.clientX - r.left) / r.width) * 100);
      };
      const stop = (): void => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', stop);
        bar.removeEventListener('pointercancel', stop);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', stop);
      bar.addEventListener('pointercancel', stop);
      e.preventDefault();
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') value = set(value - 3);
      else if (e.key === 'ArrowRight') value = set(value + 3);
      else if (e.key === 'Home' || e.key === 'Enter') value = set(41);
      else return;
      e.preventDefault();
    });
    bar.addEventListener('dblclick', () => (value = set(41)));
  });
}

/** Load-example, clear and "larger editor" buttons for the two optional boxes. */
function initSideBoxes(refresh: () => void): void {
  const guard = (id: string, what: string): boolean =>
    input(id).value.trim() === '' || window.confirm(`${what} This replaces what is in the box.`);
  $('rules-example').addEventListener('click', () => {
    if (!guard('extra-rules', 'Load the example rules?')) return;
    setBox('extra-rules', exampleRules);
    refresh();
  });
  $('rules-clear').addEventListener('click', () => {
    if (!guard('extra-rules', 'Clear your rules?')) return;
    setBox('extra-rules', '');
    refresh();
  });
  $('crds-clear').addEventListener('click', () => {
    if (!guard('extra-crds', 'Clear the CRDs?')) return;
    setBox('extra-crds', '');
    refresh();
  });
  const grow = $('rules-grow');
  grow.addEventListener('click', () => {
    const on = grow.getAttribute('aria-pressed') !== 'true';
    grow.setAttribute('aria-pressed', String(on));
    grow.textContent = on ? 'Smaller editor' : 'Larger editor';
    input('extra-rules').closest('.editor')?.classList.toggle('big', on);
  });
}

function init(): void {
  initTheme($('theme-toggle'));
  for (const id of [...SHARED, ...DIFF_BOXES, 'extra-rules', 'extra-crds', 'fix-policy'])
    editors.set(id, enhanceTextarea(input(id)));
  editors.get('explain-input')?.onLine((line) => views.explain.onLine?.(line));
  initToolbar();
  addCopyButtons();
  initSplitter();

  const refresh = debounce(() => update(active), 150);
  initSideBoxes(refresh);
  $('crd-load').addEventListener('click', () => {
    void loadCrdFromUrl().then(() => update(active));
  });
  for (const id of ['extra-rules', 'extra-crds', 'fix-policy']) {
    input(id).addEventListener('input', refresh);
  }
  for (const id of [...SHARED, ...DIFF_BOXES]) {
    input(id).addEventListener('input', () => {
      if (SHARED.includes(id)) {
        for (const other of SHARED) {
          if (other === id) continue;
          input(other).value = input(id).value;
          editors.get(other)?.refresh();
        }
      }
      refresh();
    });
  }

  for (const t of TABS) {
    const button = $(`tab-${t}`);
    button.addEventListener('click', () => select(t));
    button.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(t);
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : undefined;
      if (next === undefined) return;
      const target = TABS[(next + TABS.length) % TABS.length] as Tab;
      select(target);
      $(`tab-${target}`).focus();
    });
  }

  $('fix-risk').addEventListener('change', refresh);
  $<HTMLSelectElement>('fix-example').addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const example = fixExamples[select.value as keyof typeof fixExamples];
    select.value = '';
    if (!example) return;
    if (!confirmDiscard(SHARED, 'You have a manifest of your own in the editor.')) return;
    beforeApply = undefined;
    setManifest(example.text);
    setBox('fix-policy', example.policy);
    $<HTMLSelectElement>('fix-risk').value = example.risk;
    update('fix');
    $('fix-output').scrollTop = 0;
  });
  // Typing starts a new edit: the old undo point no longer makes sense.
  input('fix-input').addEventListener('input', () => (beforeApply = undefined));

  const fromHash = (): Tab => {
    const hash = location.hash.slice(1) as Tab;
    return TABS.includes(hash) ? hash : 'explain';
  };
  window.addEventListener('hashchange', () => {
    if (fromHash() !== active) select(fromHash());
  });
  select(fromHash());
}

init();
