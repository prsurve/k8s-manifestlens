# Automatic fixes

`manifestlens fix` turns a small set of findings into reviewed, validated patches. It previews first
and writes only when you ask. It runs offline, needs no cluster, and uses no AI service: the same
input always gives the same patch.

```sh
manifestlens fix deploy.yaml                          # preview: diff on stdout, report on stderr
manifestlens fix deploy.yaml > fixes.patch            # keep the diff; `git apply fixes.patch` applies it
manifestlens fix deploy.yaml --write                  # apply (keeps deploy.yaml.bak)
manifestlens fix deploy.yaml --policy fix-policy.yaml --max-risk medium
manifestlens fix deploy.yaml --only allow-privilege-escalation
```

Try it on [examples/fixable.yaml](../examples/fixable.yaml) with [examples/fix-policy.yaml](../examples/fix-policy.yaml).

## What can be fixed

A fix exists only when the right answer is unambiguous, or when your team states it in a policy file.
Everything else stays advice (the rule's `fix:` text). ManifestLens never invents image tags, resource
sizes, probe paths, storage settings or user IDs.

| Rule                            | Risk   | Patch                                                 | Needs                                                                  |
| ------------------------------- | ------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `allow-privilege-escalation`    | low    | `securityContext.allowPrivilegeEscalation: false`     | Container is not `privileged` and does not add `SYS_ADMIN`             |
| `may-run-as-root`               | medium | `securityContext.runAsNonRoot: true`                  | No `runAsUser: 0` and no `runAsNonRoot: false` on the container or Pod |
| `default-service-account-token` | medium | `automountServiceAccountToken: false`                 | The Pod names no service account                                       |
| `missing-seccomp-profile`       | medium | `securityContext.seccompProfile.type: RuntimeDefault` | No seccomp profile on the container or the Pod                         |
| `privileged-container`          | high   | `securityContext.privileged: false`                   | Explicit `--max-risk high`                                             |
| `missing-memory-limit`          | medium | `resources.limits.memory: <memoryLimit>`              | Policy `memoryLimit` (like `512Mi`), and no `requests.memory` set      |
| `loadbalancer-open-to-world`    | medium | `spec.loadBalancerSourceRanges: <list>`               | Policy `loadBalancerSourceRanges` (CIDRs)                              |

For each one:

- **Trigger.** The rule's own `when` condition, evaluated on the current text.
- **Preconditions.** The `requires` condition above, plus the engine's checks (below). A failed
  precondition is reported as "not applied", never forced.
- **Approval.** Risk decides. `low` is applied by default. `medium` and `high` need `--max-risk`
  (CLI), `fix-max-risk` (Action) or `manifestlens.fixMaxRisk` (VS Code). Picking a quick fix in VS Code
  is an explicit approval for that one fix.
- **Validation.** Every fix is validated before the next is planned (see "How a fix is checked").
- **Tests.** `packages/core/test/fix.test.ts` has positive, negative and regression cases for each.

Why these:

- `allow-privilege-escalation` is the standard hardening step and almost never changes behavior. It is
  skipped when the container needs escalation (`privileged`, `SYS_ADMIN`), because Kubernetes rejects
  that combination.
- `may-run-as-root` states intent without choosing an identity. It is medium risk because an image that
  really runs as root will fail to start. It is skipped when a user ID of 0 or an explicit
  `runAsNonRoot: false` makes the intent clear.
- `privileged-container` is high risk because a container may need the access. It is only ever applied
  on request.
- The two policy fixes have no safe default. A wrong limit gets Pods killed. A wrong source range cuts
  off traffic. The policy file is how your team makes the decision once, in a reviewed file.
  `memoryLimit` is skipped on containers that set `requests.memory`, because the limit could land below
  the request.

Not fixable yet, on purpose: `image-latest-tag` (needs a real tag), `missing-resource-requests`,
`missing-readiness-probe` and `missing-liveness-probe` (need numbers and paths only the app knows),
`run-as-root-user` (needs a user ID), `writable-root-filesystem` (the app may need writable
directories, and the fix needs `emptyDir` mounts), `capabilities-not-dropped`, `host-namespaces`,
`hostpath-volume`, `nodeport-service` and `single-replica`.

## Fix policy

```yaml
params:
  memoryLimit: 512Mi
  loadBalancerSourceRanges: [10.0.0.0/8]
```

Values are checked against a pattern from the rule, so `512MB` or `everyone` is rejected as
"invalid-input" instead of reaching your manifest. A missing value gives "needs-input" and names the
parameter.

## How a fix is checked

`fixManifest(source, rules, options)` is a pure function in `@manifestlens/core`. It reads nothing and
writes nothing. The CLI, web page, VS Code extension and GitHub Action all call it.

1. Run the rules. Candidates are findings whose rule has an `autofix`. Documents with YAML errors are
   never edited.
2. Take the first candidate and check risk, `requires`, policy values and conflicts with fixes already
   applied.
3. Build the edit against the **source text** with the `yaml` syntax tree: replace one scalar, or insert
   the missing keys after the last key of the right mapping. Comments, quoting, blank lines and other
   documents are not touched. Flow style (`{ a: 1 }`) and JSON are edited in their own style. A key
   that holds an alias (`securityContext: *base`) gets a local override next to a `<<: *base` merge, so
   the anchor and its other users are untouched. Layouts it still cannot edit exactly (an aliased list
   item, a comment inside an empty `{ }`, odd structures) are reported as `unsupported-layout`.
4. Check that fix on its own. The YAML must still parse, the document count must be the same, the data of
   every document must equal the original plus the intended change (nothing else may differ), the
   finding must be gone, and no new finding may appear. If any check fails, the fix is dropped and
   reported as `validation-failed`.
5. Re-run from step 1 on the new text. Fixes that were skipped for a precondition are retried, because
   an earlier fix can unblock them (for example `privileged: false` unblocks escalation).
6. At the end, validate the whole result again against the original. If that fails, the result is
   `rejected` and the output equals the input.

The result says `fixed` only after this has passed. Running the fixer on its own output gives
`unchanged`.

## Writing and recovering

- Preview is the default. The diff is a normal unified diff for `git apply` and `patch -p1`.
- `--write` re-reads the file first. If it changed since the fixes were computed, nothing is written.
  It saves the original as `<file>.bak` (or `.bak.1`, ...), writes a temporary file and renames it.
- In VS Code, fixes are one undo step (`Ctrl+Z`).
- The Action and the web page never change anything.

## Rules with a fix

Add `autofix` to a rule file. Rules without it work exactly as before and are never modified.

```yaml
id: team-label
title: Pod has no team label
severity: warning
kinds: [Pod]
when: { missing: metadata.labels.team }
message: 'Pod "{name}" has no team label.'
autofix:
  risk: low # low, medium or high
  summary: Label the Pod with the platform team.
  requires: { missing: metadata.labels } # optional, same syntax as `when`
  blocked: Pod already has labels, so add the team label by hand. # optional, shown when `requires` is false
  set:
    metadata.labels.team: platform
    resources.limits.memory: { $param: memoryLimit, pattern: '^[1-9][0-9]*(Mi|Gi)$' }
```

`set` paths are plain dotted keys relative to the rule's scope. The only operation is "set this field".
Setting a field to a mapping or list merges nothing: if a different value is already there, the fix
is skipped. A value is either written in the rule or a `$param` filled from the policy.

## Integrations

- **CLI:** `manifestlens fix` (above). Exit code 0 when previewed or written, 1 when the file has YAML
  errors or validation rejected the fixes, 2 for bad usage.
- **Web page:** the Fix tab shows what would change, what was held back, the diff, and buttons to apply the fixed manifest to the input (with undo) or copy it
  the fixed manifest.
- **VS Code:** a lightbulb quick fix on each fixable finding (labelled with its risk), and `ManifestLens:
Fix this manifest (preview first)`, which opens a diff and asks before applying.
  Settings: `manifestlens.fixMaxRisk`, `manifestlens.fixPolicy`.
- **GitHub Action:** opt in with `suggest-fixes: true` and `fix-patch-file: manifestlens-fixes.patch`.
  The job summary lists the fixes and what was held back, the JSON report gets a `fixes` section, and
  the patch is a file you can upload as an artifact. The action never edits, commits or pushes. Findings
  silenced by `ignore`, inline comments or `disable-rules` are not fixed. See
  [github-action.md](github-action.md).

```yaml
- uses: prsurve/manifestlens@v1
  with:
    fix-patch-file: manifestlens-fixes.patch
    fix-max-risk: medium
    fix-policy: .github/manifestlens-fix-policy.yaml
- uses: actions/upload-artifact@v4
  if: always() && hashFiles('manifestlens-fixes.patch') != ''
  with:
    name: manifestlens-fixes
    path: manifestlens-fixes.patch
```

## Known limits and risks

- Fixes change meaning in ways static analysis cannot prove safe. `runAsNonRoot` fails Pods whose image
  runs as root. A memory limit can OOM-kill an app. Risk levels are guidance, so review the diff.
- Edits cover block YAML, flow YAML, JSON and aliased mappings. An alias is overridden, never changed
  in place, and only when that cannot hide something it provides. The rest is skipped, not rewritten.
- A fix sets fields on the object in the file. It does not know about Kustomize patches, Helm values,
  admission policies or a `LimitRange` that may also set values. Helm templates are not Kubernetes YAML
  and are not edited.
- Regression detection compares findings by rule and place. A fix that changes a finding's message
  without adding a new place is not seen as new.
- New list items are never created, and existing values are never merged. Both are skipped.
- Lines are matched against the original text for single-finding fixes. If the file is edited between the
  quick fix being offered and chosen, VS Code applies the edit to the current buffer; the full-file
  command checks for this and refuses.
- Not done yet: more rules (probes and image pinning need an opt-in design for the values), a `--check`
  mode that exits 1 when fixes exist, multi-file `fix`, applying fixes from the Action as a pull request
  suggestion, and patch-level conflict handling across files.
