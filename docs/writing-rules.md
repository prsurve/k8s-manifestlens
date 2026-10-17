# Writing rules

A rule is a small YAML file. You do not need to write any code. Put one or more rules in a
`.yaml` file (separate rules with `---`) and pass it to the CLI:

```sh
manifestlens check deploy.yaml --rules my-rules.yaml
manifestlens check deploy.yaml --rules ./team-rules/   # every .yaml file in the folder
```

## Example

```yaml
id: missing-memory-limit
title: Container has no memory limit
severity: warning
kinds: [Pod, Deployment]
scope: container
when:
  missing: resources.limits.memory
report: resources
message: 'Container "{container}" has no memory limit.'
why: A container without a memory limit can use all the memory on its node.
fix: 'Add resources.limits.memory, for example: limits: { memory: 256Mi }.'
```

## Fields

| Field      | Required | Meaning                                                                                                                                                          |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | yes      | Unique name in lowercase words joined by dashes.                                                                                                                 |
| `title`    | yes      | Short label.                                                                                                                                                     |
| `severity` | yes      | `info`, `warning` or `error`.                                                                                                                                    |
| `kinds`    | yes      | Kubernetes kinds the rule applies to. Use `['*']` for all.                                                                                                       |
| `scope`    | no       | What `when` is evaluated against: `document` (default), `pod`, `container`, `initContainer`, or a list. A rule runs once per container for the container scopes. |
| `when`     | yes      | The condition. If it is true, the rule reports a finding.                                                                                                        |
| `report`   | no       | Path (or list of paths, first one that exists wins) the finding points at. Defaults to the scope.                                                                |
| `message`  | yes      | What is wrong. Placeholders: `{kind}`, `{name}`, `{container}`, `{value}`.                                                                                       |
| `why`      | no       | Why it matters, written for someone new to Kubernetes.                                                                                                           |
| `fix`      | no       | What to change.                                                                                                                                                  |

`scope: pod` and the container scopes work for Pod and Deployment. Paths in `when` are relative to the scope.
Start a path with `$pod.` to read from the Pod spec instead, for example `$pod.securityContext.runAsNonRoot`.

## Conditions

Every condition has exactly one operator.

| Operator                     | True when                                          |
| ---------------------------- | -------------------------------------------------- |
| `missing: path`              | the field is absent (or empty)                     |
| `present: path`              | the field exists                                   |
| `equals: { path: value }`    | the field equals the value                         |
| `in: { path: [a, b] }`       | the field equals one of the values                 |
| `contains: { path: value }`  | the field is a list that includes the value        |
| `matches: { path: 'regex' }` | the field, as text, matches the regular expression |
| `all: [...]` / `any: [...]`  | all / at least one of the conditions are true      |
| `not: condition`             | the condition is false                             |

Add `[]` to a key to look at every item of a list: `present: volumes[].hostPath` is true if any volume has a `hostPath`.

## Contributing a rule

Built-in rules live in `rules/`. After editing them run `npm run bundle-rules` (the build does this too).
The tests check that every built-in rule fires on `test/fixtures/risky.yaml` and that
`test/fixtures/hardened.yaml` stays clean, so add a case to those fixtures for a new rule.
