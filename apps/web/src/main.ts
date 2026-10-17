import {
  RuleError,
  checkManifest,
  diffManifests,
  explainManifest,
  loadBundledRules,
  parseRules,
} from '@manifestlens/core';
import type { Rule } from '@manifestlens/core';
import './style.css';
import { examples } from './examples.js';
import { renderCheck, renderDiff, renderExplain, renderMessage } from './render.js';

type Tab = 'explain' | 'check' | 'diff';
const TABS: Tab[] = ['explain', 'check', 'diff'];

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

const bundled = loadBundledRules();

/** Bundled rules plus any the user pasted. Shows the error and falls back to bundled on bad rules. */
function currentRules(): Rule[] {
  const text = $<HTMLTextAreaElement>('extra-rules').value;
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

function show(output: HTMLElement, content: HTMLElement): void {
  output.replaceChildren(content);
}

function update(tab: Tab): void {
  if (tab === 'explain') {
    const source = $<HTMLTextAreaElement>('explain-input').value;
    const out = $('explain-output');
    if (source.trim() === '')
      return show(out, renderMessage('Paste a manifest to see it explained.'));
    const result = explainManifest(source);
    show(
      out,
      result.documents.length
        ? renderExplain(result, source)
        : renderMessage('No Kubernetes documents found.'),
    );
  } else if (tab === 'check') {
    const source = $<HTMLTextAreaElement>('check-input').value;
    const out = $('check-output');
    if (source.trim() === '') return show(out, renderMessage('Paste a manifest to check it.'));
    const result = checkManifest(source, currentRules());
    show(
      out,
      result.documents.length
        ? renderCheck(result)
        : renderMessage('No Kubernetes documents found.'),
    );
  } else {
    const oldText = $<HTMLTextAreaElement>('diff-old').value;
    const newText = $<HTMLTextAreaElement>('diff-new').value;
    const out = $('diff-output');
    if (oldText.trim() === '' || newText.trim() === '') {
      return show(out, renderMessage('Paste both versions to see what the change will do.'));
    }
    show(out, renderDiff(diffManifests(oldText, newText, currentRules())));
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
  const refresh = debounce(() => update(active), 150);
  for (const id of ['explain-input', 'check-input', 'diff-old', 'diff-new', 'extra-rules']) {
    $(id).addEventListener('input', refresh);
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
        $<HTMLTextAreaElement>('diff-old').value = examples.diff.old;
        $<HTMLTextAreaElement>('diff-new').value = examples.diff.new;
      } else {
        $<HTMLTextAreaElement>(`${which}-input`).value = examples[which];
      }
      update(which);
    });
  });

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
