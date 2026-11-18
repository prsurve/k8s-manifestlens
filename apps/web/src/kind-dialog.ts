import {
  BUILT_IN_INVENTORY,
  KindStore,
  RuleError,
  buildRegistry,
  classifyKind,
  explainManifest,
  findBuiltIn,
  importCrds,
  importOpenApi,
  registerKinds,
  splitApiVersion,
} from '@k8s-manifestlens/core';
import type {
  KindPreview,
  RejectedKind,
  Rule,
  SchemaIdentity,
  StoredKindSet,
} from '@k8s-manifestlens/core';
import { el } from './dom.js';
import type { OnboardDetail } from './kind-notice.js';

export interface KindUiContext {
  store: KindStore;
  /** Called after the saved kinds change: reload the rules and re-analyze what is on screen. */
  onChange: () => Promise<void>;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a schema can and cannot check, for one or more kinds, shown before anything is registered. */
export function renderPreview(previews: KindPreview[], rejected: RejectedKind[] = []): HTMLElement {
  const root = el('div', { class: 'kind-preview' });
  for (const p of previews) {
    const refused = rejected.filter((r) => r.group === p.group && r.kind === p.kind);
    root.append(
      el('section', { class: 'kind-card' }, [
        el('h3', {}, [
          p.kind,
          el('span', { class: 'meta', text: p.group === '' ? 'core' : p.group }),
        ]),
        el('p', {
          class: 'meta',
          text: `Scope: ${p.scope ?? 'not stated'} · Versions: ${p.versions.map((v) => v.version).join(', ')}`,
        }),
        ...refused.map((r) => el('p', { class: 'error', text: r.reason })),
        ...p.versions.map((v) => {
          const c = v.capabilities;
          return el('div', { class: 'kind-version' }, [
            el('strong', { text: v.version }),
            el('span', {
              class: 'meta',
              text:
                c.level === 'basic'
                  ? ' · Basic: the kind is recognised, but the schema lists no fields, so nothing inside it is checked.'
                  : ` · Schema-backed: ${c.fields.length}${c.fieldsTruncated ? '+' : ''} fields, ${c.requiredFields.length} required`,
            }),
            c.supported.length > 0 &&
              el('p', {}, [
                'Checked: ',
                el('span', { class: 'meta', text: c.supported.join(', ') }),
              ]),
            c.unsupported.length > 0 &&
              el('div', { class: 'callout callout-warning' }, [
                el('strong', { text: 'Not checked' }),
                el('p', {
                  text: 'The schema uses these, but ManifestLens does not evaluate them. "No findings" does not mean those parts are valid.',
                }),
                el(
                  'ul',
                  {},
                  c.unsupported.map((u) =>
                    el('li', {
                      text: `${u.keyword} (${u.count}×, first at ${u.firstPath})`,
                    }),
                  ),
                ),
              ]),
            c.requiredFields.length > 0 &&
              el('details', {}, [
                el('summary', { text: 'Required fields' }),
                el('p', { class: 'meta', text: c.requiredFields.join(', ') }),
              ]),
            c.fields.length > 0 &&
              el('details', {}, [
                el('summary', { text: 'Fields' }),
                el('p', { class: 'meta', text: c.fields.map((f) => f.path).join(', ') }),
              ]),
          ]);
        }),
      ]),
    );
  }
  return root;
}

function dialog(): HTMLDialogElement {
  let d = document.getElementById('kind-dialog') as HTMLDialogElement | null;
  if (!d) {
    d = el('dialog', { class: 'kind-dialog', attrs: { id: 'kind-dialog' } });
    document.body.append(d);
  }
  return d;
}

function open(content: HTMLElement[]): HTMLDialogElement {
  const d = dialog();
  const close = el('button', { class: 'btn', text: 'Close', attrs: { type: 'button' } });
  close.addEventListener('click', () => d.close());
  d.replaceChildren(...content, el('div', { class: 'kind-actions' }, [close]));
  if (!d.open) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  return d;
}

const CONTRIBUTE = [
  'Find the resource in the Kubernetes OpenAPI spec (swagger.json) and note its definition name, e.g. io.k8s.api.coordination.v1.Lease.',
  'Add it to ROOTS in packages/core/scripts/generate-schema.mjs.',
  'Regenerate: npm run generate-schema --workspace packages/core -- --spec swagger.json --version <vX.Y.Z>',
  'Add a test, check the generated explanations, and run the full test suite.',
  'Open a pull request on GitHub. ManifestLens never changes the repository for you.',
];

/** The wizard: choose a schema, preview what it can check, register it, and re-analyze the manifest. */
export function openOnboarding(
  ctx: KindUiContext,
  hint?: OnboardDetail,
  prefill?: StoredKindSet,
): void {
  const split = splitApiVersion(hint?.apiVersion ?? '');
  const classification = hint ? classifyKind(hint.kind, hint.apiVersion) : undefined;
  const builtIn = hint ? findBuiltIn(hint.kind).find((b) => b.group === split.group) : undefined;

  const format = el('select', { attrs: { 'aria-label': 'Schema format' } }, [
    el('option', { text: 'CustomResourceDefinition (YAML)', attrs: { value: 'crd' } }),
    el('option', { text: 'OpenAPI schema (JSON or YAML)', attrs: { value: 'openapi' } }),
  ]);
  format.value = prefill?.format ?? (builtIn ? 'openapi' : 'crd');
  const text = el('textarea', {
    class: 'kind-text',
    attrs: {
      spellcheck: 'false',
      'aria-label': 'Schema text',
      placeholder: 'Paste a CRD or OpenAPI schema',
    },
  });
  text.value = prefill?.text ?? '';
  const file = el('input', {
    attrs: { type: 'file', accept: '.yaml,.yml,.json,.txt', 'aria-label': 'Upload a schema file' },
  });
  file.addEventListener('change', () => {
    void file.files?.[0]?.text().then((t) => {
      text.value = t;
      preview();
    });
  });
  const field = (label: string, value: string): HTMLInputElement => {
    const i = el('input', { attrs: { type: 'text', 'aria-label': label, placeholder: label } });
    i.value = value;
    return i;
  };
  const group = field('API group', prefill?.identity?.group ?? builtIn?.group ?? split.group);
  const version = field('Version', prefill?.identity?.version ?? builtIn?.version ?? split.version);
  const kind = field('Kind', prefill?.identity?.kind ?? hint?.kind ?? '');
  const scope = el('select', { attrs: { 'aria-label': 'Scope' } }, [
    el('option', { text: 'Namespaced', attrs: { value: 'Namespaced' } }),
    el('option', { text: 'Cluster', attrs: { value: 'Cluster' } }),
  ]);
  scope.value =
    prefill?.identity?.scope ?? (builtIn && !builtIn.namespaced ? 'Cluster' : 'Namespaced');
  const identityRow = el('div', { class: 'kind-identity' }, [
    el('p', {
      class: 'meta',
      text: 'Which kind this schema describes. Only needed when the schema does not say so itself.',
    }),
    group,
    version,
    kind,
    scope,
  ]);
  const syncFormat = (): void => {
    identityRow.hidden = format.value !== 'openapi';
  };
  format.addEventListener('change', syncFormat);
  syncFormat();

  const result = el('div', { class: 'kind-result', attrs: { 'aria-live': 'polite' } });
  const previewBtn = el('button', { class: 'btn', text: 'Preview', attrs: { type: 'button' } });
  const registerBtn = el('button', {
    class: 'btn primary',
    text: 'Register',
    attrs: { type: 'button' },
  });
  registerBtn.disabled = true;

  const identity = (): SchemaIdentity => ({
    group: group.value.trim(),
    version: version.value.trim(),
    kind: kind.value.trim(),
    scope: scope.value as 'Namespaced' | 'Cluster',
  });
  const compile = (): { rules: Rule[]; previews: KindPreview[] } =>
    format.value === 'crd'
      ? importCrds(text.value, 'your CRD')
      : importOpenApi(text.value, identity().kind === '' ? undefined : identity(), 'your schema');

  async function preview(): Promise<void> {
    registerBtn.disabled = true;
    if (text.value.trim() === '') {
      result.replaceChildren(el('p', { class: 'error', text: 'Paste or upload a schema first.' }));
      return;
    }
    try {
      const { rules, previews } = compile();
      const current = (await ctx.store.load()).rules;
      const { rejected, added, updated } = registerKinds(current, rules);
      result.replaceChildren(renderPreview(previews, rejected));
      registerBtn.disabled = added.length + updated.length === 0;
    } catch (e) {
      result.replaceChildren(
        el('p', { class: 'error', text: message(e), attrs: { role: 'alert' } }),
      );
    }
  }
  previewBtn.addEventListener('click', () => void preview());
  registerBtn.addEventListener('click', () => {
    registerBtn.disabled = true;
    void (async () => {
      try {
        const out = await ctx.store.add(format.value as 'crd' | 'openapi', text.value, {
          origin: 'your schema',
          ...(format.value === 'openapi' && identity().kind !== '' ? { identity: identity() } : {}),
        });
        await ctx.onChange();
        const names = [...out.registration.added, ...out.registration.updated];
        result.replaceChildren(
          names.length > 0
            ? el('div', { class: 'callout callout-ok' }, [
                el('strong', { text: 'Registered' }),
                el('p', {
                  text: `${names.join(', ')}. Your manifest was re-analyzed and is unchanged.`,
                }),
              ])
            : el('p', {
                class: 'error',
                text: out.registration.rejected[0]?.reason ?? 'Nothing was registered.',
              }),
        );
      } catch (e) {
        result.replaceChildren(el('p', { class: 'error', text: message(e) }));
      }
    })();
  });

  const heading = hint ? `Add support for ${hint.kind}` : 'Import a schema';
  const intro =
    classification?.category === 'missing-builtin' && builtIn
      ? el('div', {}, [
          el('p', {
            text: `${builtIn.kind} is a built-in Kubernetes kind (${builtIn.group === '' ? 'core' : builtIn.group}/${builtIn.version}, ${builtIn.namespaced ? 'namespaced' : 'cluster-scoped'}) that ManifestLens does not cover yet. You can import a schema to use it on this device now.`,
          }),
          el('details', {}, [
            el('summary', { text: 'Add it permanently (GitHub contribution guide)' }),
            el(
              'ol',
              {},
              CONTRIBUTE.map((s) => el('li', { text: s })),
            ),
          ]),
        ])
      : el('p', {
          text: 'Import a CustomResourceDefinition or an OpenAPI schema. It stays in this browser and is never uploaded.',
        });

  open([
    el('h2', { text: heading }),
    intro,
    el('div', { class: 'kind-form' }, [format, file, identityRow, text]),
    el('div', { class: 'kind-actions' }, [previewBtn, registerBtn]),
    result,
  ]);
  if (prefill) void preview();
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = el('a', { attrs: { href: url, download: name } });
  a.click();
  URL.revokeObjectURL(url);
}

/** Manage Kinds: what is built in, what is missing, and what you imported. */
export function openManager(ctx: KindUiContext): void {
  const body = el('div', { class: 'kind-manager' });
  const search = el('input', {
    class: 'filter',
    attrs: { type: 'search', placeholder: 'Search kinds', 'aria-label': 'Search kinds' },
  });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const row of body.querySelectorAll<HTMLElement>('[data-search]')) {
      row.hidden = q !== '' && !(row.dataset.search ?? '').includes(q);
    }
  });

  const section = (title: string, rows: HTMLElement[], empty: string): HTMLElement =>
    el('section', {}, [
      el('h3', { text: `${title} (${rows.length})` }),
      rows.length > 0
        ? el('ul', { class: 'kind-list' }, rows)
        : el('p', { class: 'meta', text: empty }),
    ]);
  const row = (label: string, detail: string, actions: HTMLElement[] = []): HTMLElement => {
    const li = el('li', { attrs: { 'data-search': `${label} ${detail}`.toLowerCase() } }, [
      el('span', {}, [
        el('strong', { text: label }),
        ' ',
        el('span', { class: 'meta', text: detail }),
      ]),
      el('span', { class: 'kind-row-actions' }, actions),
    ]);
    return li;
  };
  const btn = (label: string, run: () => void): HTMLButtonElement => {
    const b = el('button', { class: 'btn', text: label, attrs: { type: 'button' } });
    b.addEventListener('click', run);
    return b;
  };

  async function render(): Promise<void> {
    const [sets, loaded] = await Promise.all([ctx.store.list(), ctx.store.load()]);
    const builtIn = buildRegistry().filter(
      (e) => e.source === 'handwritten' || e.source === 'generated',
    );
    const covered = new Set(builtIn.map((e) => `${e.group}/${e.kind}`));
    const gv = (g: string, v: string): string => (g === '' ? v : `${g}/${v}`);
    const missing = BUILT_IN_INVENTORY.filter((b) => !covered.has(`${b.group}/${b.kind}`));

    const setRow = (s: StoredKindSet): HTMLElement => {
      const names = s.kinds.map((k) => k.kind).join(', ');
      const detail = el('div', { class: 'kind-detail' });
      detail.hidden = true;
      const compile = (): KindPreview[] =>
        (s.format === 'crd' ? importCrds(s.text, s.id) : importOpenApi(s.text, s.identity, s.id))
          .previews;
      const view = btn('View', () => {
        detail.hidden = !detail.hidden;
        if (!detail.hidden) detail.replaceChildren(renderPreview(compile()));
      });
      const test = btn('Test schema', () => {
        detail.hidden = false;
        const sample = el('textarea', {
          class: 'kind-text',
          attrs: {
            spellcheck: 'false',
            'aria-label': 'Sample manifest',
            placeholder: `Paste a ${names} manifest`,
          },
        });
        const out = el('div', { attrs: { 'aria-live': 'polite' } });
        const run = btn('Run', () => {
          try {
            const rules = importable(s);
            const docs = explainManifest(sample.value, rules).documents;
            const issues = docs.flatMap((d) => d.issues.map((i) => i.message));
            out.replaceChildren(
              docs.some((d) => d.unsupportedKind)
                ? el('p', {
                    class: 'error',
                    text: 'This manifest is not one of the kinds in this schema.',
                  })
                : issues.length > 0
                  ? el(
                      'ul',
                      {},
                      issues.map((m) => el('li', { text: m })),
                    )
                  : el('p', {
                      text: 'No findings. Parts of the schema that are not checked are listed under View.',
                    }),
            );
          } catch (e) {
            out.replaceChildren(el('p', { class: 'error', text: message(e) }));
          }
        });
        detail.replaceChildren(sample, run, out);
      });
      const importable = (set: StoredKindSet): Rule[] =>
        (set.format === 'crd'
          ? importCrds(set.text, set.id)
          : importOpenApi(set.text, set.identity, set.id)
        ).rules;
      return el(
        'li',
        {
          attrs: {
            'data-search': `${names} ${s.kinds.map((k) => k.group).join(' ')}`.toLowerCase(),
          },
        },
        [
          el('div', { class: 'kind-row' }, [
            el('span', {}, [
              el('strong', { text: names }),
              ' ',
              el('span', {
                class: 'meta',
                text: `${s.format === 'crd' ? 'CRD' : 'OpenAPI'} · ${s.kinds.map((k) => k.versions.join('/')).join(', ')}${s.enabled ? '' : ' · disabled'}`,
              }),
            ]),
            el('span', { class: 'kind-row-actions' }, [
              view,
              test,
              btn('Update', () => openOnboarding(ctx, undefined, s)),
              btn('Export', () => {
                void ctx.store
                  .export([s.id])
                  .then((j) => download(`${names.replace(/[^\w.-]+/g, '_')}.kinds.json`, j));
              }),
              btn(s.enabled ? 'Disable' : 'Enable', () => {
                void ctx.store.setEnabled(s.id, !s.enabled).then(ctx.onChange).then(render);
              }),
              btn('Remove', () => {
                if (
                  !window.confirm(
                    `Remove ${names}? Manifests of this kind will no longer be explained.`,
                  )
                )
                  return;
                void ctx.store.remove(s.id).then(ctx.onChange).then(render);
              }),
            ]),
          ]),
          detail,
        ],
      );
    };

    const importFile = el('input', {
      attrs: { type: 'file', accept: '.json', 'aria-label': 'Import an export file' },
    });
    const status = el('p', { class: 'meta', attrs: { 'aria-live': 'polite' } });
    importFile.addEventListener('change', () => {
      void (async () => {
        try {
          const f = importFile.files?.[0];
          if (!f) return;
          const r = await ctx.store.import(await f.text());
          await ctx.onChange();
          status.textContent = `Imported ${r.imported.length}${r.skipped.length ? `; skipped ${r.skipped.length}: ${r.skipped.map((x) => `${x.id} (${x.message})`).join('; ')}` : ''}.`;
          await render();
        } catch (e) {
          status.textContent = e instanceof RuleError || e instanceof Error ? e.message : String(e);
        }
      })();
    });

    body.replaceChildren(
      ...loaded.problems.map((p) =>
        el('p', { class: 'error', text: `${p.id} could not be loaded: ${p.message}` }),
      ),
      section(
        'Built-in kinds',
        builtIn.map((e) =>
          row(
            e.kind,
            `${gv(e.group, e.version)} · ${e.source === 'handwritten' ? 'hand-written' : 'generated'}`,
          ),
        ),
        'None.',
      ),
      section(
        'Missing built-in coverage',
        missing.map((b) =>
          row(b.kind, gv(b.group, b.version), [
            btn('Add support', () =>
              openOnboarding(ctx, { kind: b.kind, apiVersion: gv(b.group, b.version) }),
            ),
          ]),
        ),
        'Every known built-in kind is covered.',
      ),
      section(
        'Imported CRDs',
        sets.filter((s) => s.format === 'crd').map(setRow),
        'None imported.',
      ),
      section(
        'Imported OpenAPI schemas',
        sets.filter((s) => s.format === 'openapi').map(setRow),
        'None imported.',
      ),
      section(
        'Ecosystem packs',
        [],
        'Resource packs (OpenShift, KubeVirt, Argo CD and more) are planned for a later release.',
      ),
      el('div', { class: 'kind-actions' }, [
        btn('Import a schema', () => openOnboarding(ctx)),
        btn('Export all', () => {
          void ctx.store.export().then((j) => download('manifestlens-kinds.json', j));
        }),
        el('label', { class: 'meta' }, ['Restore from export: ', importFile]),
      ]),
      status,
    );
    if (search.value !== '') search.dispatchEvent(new Event('input'));
  }

  open([el('h2', { text: 'Manage kinds' }), search, body]);
  void render();
}
