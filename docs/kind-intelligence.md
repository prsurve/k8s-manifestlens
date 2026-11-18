# Kind intelligence

k8s-manifestlens can learn new resource kinds without waiting for a release. This page covers how it
tells kinds apart, how to add one in each place you use the tool, and what an added kind can and cannot check.

## What it says about a kind it does not explain

Every manifest gets one of these answers, so an unknown kind is never just called a CRD:

| Answer           | Meaning                                                                                       | What to do                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Supported        | Explained by a built-in definition or an imported schema.                                     | Nothing.                                                                       |
| Missing built-in | A real Kubernetes kind (for example `Lease`, `Node`, `IngressClass`) that is not covered yet. | Import its OpenAPI schema, or [add it permanently](adding-a-built-in-kind.md). |
| Custom resource  | Its API group is not a Kubernetes one and no schema is loaded.                                | Import its CRD.                                                                |
| Unknown          | Not a built-in and not in a custom group, so probably a typo.                                 | Check the spelling.                                                            |
| Malformed        | `kind` or `apiVersion` is missing or not a valid name.                                        | Fix the manifest.                                                              |

A kind that is known but written with an `apiVersion` we do not know (for example `apps/v1beta1`
`Deployment`) is still explained, and the version is flagged.

## Adding a kind

You need either a CustomResourceDefinition or an OpenAPI schema.

```sh
kubectl get crd certificates.cert-manager.io -o yaml > certificate-crd.yaml
```

| Where         | How                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Web page      | Click **Add support** or **Import schema** on the notice, or open **Manage kinds**. Paste or upload, check the preview, then **Register**. |
| CLI           | `k8s-manifestlens kinds preview <file>` then `kinds add <file>`. `explain`, `check`, `diff` and `fix` use the saved kinds automatically.   |
| GitHub Action | Commit a registry file and set `kinds: .github/kinds.json`. See [the Action](github-action.md).                                            |
| VS Code       | Use the quick fix **Add support for &lt;Kind&gt;…** or the command **Add a custom resource or kind schema…**. See the extension README.    |

### An OpenAPI schema

An OpenAPI document works when each schema has `x-kubernetes-group-version-kind`, as the Kubernetes
`swagger.json` does. A single schema needs you to say which kind it describes: in the web page fill in group,
version and kind, in the CLI pass `--group`, `--version` and `--kind`, and in VS Code answer the prompt.
Local `$ref`s are resolved for you.

### Preview before you register

The preview shows the kind, group, scope, versions, fields and required fields. It also lists:

- **Checked:** required fields, types, enums, patterns, minimum and maximum, string lengths, unknown fields.
- **Not checked:** anything in the schema we see but do not evaluate, such as `oneOf`, `anyOf`, `allOf`, `not`,
  CEL rules (`x-kubernetes-validations`), `format`, `minItems`, `maxItems`, `uniqueItems`, `multipleOf`,
  unresolved `$ref`s, and patterns that can take exponential time.

"No findings" never means those parts are valid. A schema with no fields is **basic**: the kind is recognised
and described, but nothing inside it is checked.

## The kind registry

Added kinds are saved so they last across sessions:

| Where   | Stored in                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------- |
| Web     | Your browser's IndexedDB. Nothing is uploaded.                                                 |
| CLI     | `--registry`, else `$K8S_MANIFESTLENS_REGISTRY`, else `~/.config/k8s-manifestlens/kinds.json`. |
| VS Code | The extension's own storage, plus any files in the `k8sManifestlens.kinds` setting.            |
| Action  | Files you commit and list in `kinds`.                                                          |

The saved text is your original CRD or schema. It is compiled again each time, so there is one analysis
engine everywhere. You can export, disable, update and remove kinds (web **Manage kinds**, CLI `kinds export`,
`disable`, `remove`). The export file is the same JSON everywhere, so a registry made in one place loads in
another. Use `--no-registry` on the CLI for a run that ignores your saved kinds.

## Conflicts

Definitions are ranked: hand-written, generated, imported CRD, imported OpenAPI, ecosystem pack. A higher
one always wins. An imported schema can never replace a built-in kind: it is refused with the reason, and the
Action fails the build instead of skipping it. A CRD given with `--crd` or `crds` wins over a saved copy of the
same kind, because you named it for this run.

## Safety

Schemas can come from other people, so they are treated as untrusted:

- Text is only ever shown as text. File and registry sizes are capped.
- Patterns that can take exponential time are not run. They are reported as not checked.
- Schemas that grow too large once `$ref`s are resolved, or nest too deeply, are refused.
- The Action reads only files inside the repository, including through symbolic links.

Nothing about your manifests or schemas is collected, and no network request is made to add a kind.

## Not part of this release

- Ecosystem packs (OpenShift, KubeVirt, Argo CD, Prometheus Operator, Gateway API). The Manage kinds page
  shows an empty section for them.
- Enhanced kinds with extra YAML rules and safe fixes. You can already write [rules](writing-rules.md) for a
  custom kind, but they are not bundled with the schema.
- Checking relationships between resources.
