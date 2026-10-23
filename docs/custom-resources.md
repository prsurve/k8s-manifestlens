# Custom resources

ManifestLens knows the built-in Kubernetes kinds. For a custom resource (cert-manager's `Certificate`,
an Argo CD `Application`, your own operator's kind) give it the CustomResourceDefinition (CRD) and it will:

- explain the fields, using the descriptions in the CRD;
- check the manifest against the CRD's schema.

## Getting a CRD

```sh
kubectl get crd certificates.cert-manager.io -o yaml > certificate-crd.yaml
```

A file may hold several CRDs separated by `---`, or the `items` of a `kind: List`.

## Using it

| Where         | How                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Web page      | Paste the YAML into "Custom resources: paste a CRD". It stays local.                                         |
| CLI           | `manifestlens check app.yaml --crd certificate-crd.yaml` (also `explain`, `diff`, `fix`; a folder works too) |
| GitHub Action | `crds: k8s/crds` (files or folders inside the repository)                                                    |

The Load button only accepts `github.com/.../blob/...`, `raw.githubusercontent.com` and
`gist.githubusercontent.com` links over https. The browser downloads the file itself. For any other
site, copy the text and paste it. The CLI and the Action read files only: use `curl -o crd.yaml <url>`
first.

## What is checked

| Finding                | Severity | When                                                                                |
| ---------------------- | -------- | ----------------------------------------------------------------------------------- |
| `crd-unknown-field`    | warning  | A field the schema does not list (with a "did you mean" for typos).                 |
| `crd-wrong-type`       | error    | A string where the schema wants an integer, a list for a mapping, ...               |
| `crd-invalid-value`    | error    | Not in the `enum`, fails `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`. |
| `crd-missing-required` | error    | A `required` field is absent.                                                       |
| `crd-unknown-version`  | warning  | The `apiVersion` is not one of the CRD's versions.                                  |

## Limits

- A CRD describes the shape of a resource, not good practice. ManifestLens does not judge whether
  the values are risky. Write [rules](writing-rules.md) for that, using the custom kind in `kinds`.
- Fixes are not generated from a CRD.
- Parts of a schema that need a full validator (`oneOf`, `anyOf`, `allOf`, `not`, and CEL
  `x-kubernetes-validations`) are skipped, not guessed at. Fields under
  `x-kubernetes-preserve-unknown-fields` accept anything.
- `pattern` values written for Go that JavaScript cannot read are ignored.
- Passing the schema does not mean the operator will accept or the cluster will run the resource.
