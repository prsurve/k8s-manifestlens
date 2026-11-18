# k8s-manifestlens for VS Code

Explains Kubernetes YAML in plain English and flags risky settings, right in the editor. It works
offline: nothing is sent anywhere. You can also [try it in your browser](https://k8s-manifestlens.k8ssimplified.in).

## What you get

- **Warnings in the editor.** Missing resource limits, root containers, `latest` image tags, missing
  probes and more show up as squiggles on the right line. Each one says why it matters and how to fix it.
- **Explanations on hover.** Hover a field in a Pod, Deployment or Service to see what it does, with a
  link to the official Kubernetes docs.
- **Explain this manifest.** Run `k8s-manifestlens: Explain this manifest` from the Command Palette to get the
  whole file explained line by line.

It understands 25 kinds, including Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, Service and
Ingress. Only files that declare both `apiVersion` and `kind` are checked, so other YAML files (CI configs,
docker-compose, Helm templates) are left alone.

## Settings

| Setting                           | Default | Meaning                                                                     |
| --------------------------------- | ------- | --------------------------------------------------------------------------- |
| `k8sManifestlens.enable`          | `true`  | Turn checks and hover on or off.                                            |
| `k8sManifestlens.minimumSeverity` | `info`  | Hide findings below `info`, `warning` or `error`.                           |
| `k8sManifestlens.rules`           | `[]`    | Extra rule files or folders. Relative paths start at the workspace.         |
| `k8sManifestlens.kinds`           | `[]`    | Kind registry files or folders (JSON from `k8s-manifestlens kinds export`). |

Rules are plain YAML. See the
[rule guide](https://github.com/prsurve/k8s-manifestlens/blob/main/docs/writing-rules.md).

## Custom resources and kinds it does not cover

A kind with no explanations gets an info message on its first line. Use the lightbulb quick fix
**Add support for &lt;Kind&gt;…** (or the command **k8s-manifestlens: Add a custom resource or kind schema…**) to
import a CustomResourceDefinition or an OpenAPI schema from the clipboard or a file. You see a preview first,
including which constraints are **not** checked, and nothing is registered until you confirm. Open files are
re-checked straight away and your text is never changed. Imported kinds are kept across restarts;
**k8s-manifestlens: Manage imported kinds** lists, disables, removes and exports them. A schema that claims a
built-in kind is refused. To share kinds with a team, commit a registry file and list it in
`k8sManifestlens.kinds`.

## License

Apache-2.0.
