import {
  RuleError,
  checkManifest,
  diffManifests,
  FixPolicyError,
  explainManifest,
  fixManifest,
  loadBundledRules,
  parseFixPolicy,
  parseRules,
  unifiedDiff,
} from '@k8s-manifestlens/core';
import type { FixPolicy, FixRisk, Rule } from '@k8s-manifestlens/core';
import { inject } from '@vercel/analytics';
import './style.css';
import { examples, fixExamples } from './examples.js';
import { initTheme } from './theme.js';
import {
  createView,
  renderCheck,
  renderDiff,
  renderExplain,
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

/** Bundled rules plus any the user pasted. Shows the error and falls back to bundled on bad rules. */
function currentRules(): Rule[] {
  const text = input('extra-rules').value;
  const error = $('rules-error');
  error.hidden = true;
  if (text.trim() === '') return bundled;
  try {
    const extra = parseRules(text, 'your rules');
    const ids = new Set(bundled.map((r) => r.id));
    const clash = extra.find((r) => ids.has(r.id));
    if (clash) throw new RuleError(`Rule id "${clash.id}" is already used by a built-in rule.`);
    return [...bundled, ...extra];
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
    return bundled;
  }
}

/** Select a line of a text box and bring it into view, so a result row can point at its source. */
function selectLine(box: HTMLTextAreaElement, line: number): void {
  const lines = box.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += (lines[i]?.length ?? 0) + 1;
  const end = start + (lines[line - 1]?.length ?? 0);
  box.focus({ preventScroll: true });
  box.setSelectionRange(start, end);
  const lineHeight = Number.parseFloat(getComputedStyle(box).lineHeight) || 18;
  box.scrollTop = Math.max(0, (line - 1) * lineHeight - box.clientHeight / 2);
}

const jumpers: Record<Tab, (target: JumpTarget, line: number) => void> = {
  explain: (_t, line) => selectLine(input('explain-input'), line),
  check: (_t, line) => selectLine(input('check-input'), line),
  diff: (target, line) => selectLine(input(target === 'old' ? 'diff-old' : 'diff-new'), line),
  fix: (_t, line) => selectLine(input('fix-input'), line),
};
const views = {
  explain: createView(jumpers.explain),
  check: createView(jumpers.check),
  diff: createView(jumpers.diff),
  fix: createView(jumpers.fix),
};

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

function update(tab: Tab): void {
  if (tab === 'explain') {
    const source = input('explain-input').value;
    const out = $('explain-output');
    if (source.trim() === '')
      return show(out, renderMessage('Paste a manifest to see it explained, line by line.'));
    const result = explainManifest(source);
    show(
      out,
      result.documents.length
        ? renderExplain(result, source, views.explain)
        : renderMessage('No Kubernetes documents found.'),
    );
  } else if (tab === 'check') {
    const source = input('check-input').value;
    const out = $('check-output');
    if (source.trim() === '')
      return show(out, renderMessage('Paste a manifest to flag risky settings.'));
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
      return show(out, renderMessage('Paste a manifest to preview automatic fixes.'));
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
          jump: (line) => selectLine(input('fix-input'), line),
          apply: (text) => {
            beforeApply = input('fix-input').value;
            input('fix-input').value = text;
            update('fix');
          },
          ...(beforeApply !== undefined
            ? {
                undo: () => {
                  input('fix-input').value = beforeApply ?? '';
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
        renderMessage('Paste both versions to see what applying the change will do.'),
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

function init(): void {
  initTheme($('theme-toggle'));
  const refresh = debounce(() => update(active), 150);
  for (const id of [
    'explain-input',
    'check-input',
    'diff-old',
    'diff-new',
    'extra-rules',
    'fix-input',
    'fix-policy',
  ]) {
    input(id).addEventListener('input', refresh);
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

  document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
    button.addEventListener('click', () => {
      const which = button.dataset.example as Tab;
      if (which === 'diff') {
        input('diff-old').value = examples.diff.old;
        input('diff-new').value = examples.diff.new;
      } else {
        input(`${which}-input`).value = examples[which];
      }
      update(which);
      $(`${which}-output`).scrollTop = 0;
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach((button) => {
    button.addEventListener('click', () => {
      const which = button.dataset.clear as Tab;
      for (const id of which === 'diff' ? ['diff-old', 'diff-new'] : [`${which}-input`])
        input(id).value = '';
      update(which);
    });
  });

  $('fix-risk').addEventListener('change', refresh);
  $<HTMLSelectElement>('fix-example').addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const example = fixExamples[select.value as keyof typeof fixExamples];
    select.value = '';
    if (!example) return;
    beforeApply = undefined;
    input('fix-input').value = example.text;
    input('fix-policy').value = example.policy;
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
