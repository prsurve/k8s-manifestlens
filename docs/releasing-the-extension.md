# Releasing the VS Code extension

The extension (`prsurve.k8s-manifestlens-vscode`, in `packages/vscode`) is published to the Visual Studio
Marketplace by GitHub Actions when you push a tag named `vscode-vX.Y.Z`. There is no token or secret
involved: the workflow proves its identity to the Marketplace with a short-lived GitHub OIDC token
(Trusted Publishing, `vsce publish --oidc`).

## How it works

| Event                        | Workflow                                                      | What runs                                                                                    | Publishes?                             |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Pull request, push to `main` | [ci.yml](../.github/workflows/ci.yml)                         | typecheck, lint, format check, tests, build, and a VSIX packaging check (Node 24)            | No                                     |
| Push of a `vscode-v*` tag    | [publish-vscode.yml](../.github/workflows/publish-vscode.yml) | the same checks, a tag check, then package, publish, and attach the VSIX to a GitHub Release | Yes, only if every earlier step passed |

The release workflow has three jobs, each depending on the one before:

1. **build** checks that the tag is `vscode-vX.Y.Z`, matches `packages/vscode/package.json`, has a
   `## X.Y.Z` heading in `packages/vscode/CHANGELOG.md`, and points at a commit on `main`. It then runs
   the full checks, builds, packs `k8s-manifestlens.vsix`, and uploads it as the `vsix` workflow artifact.
2. **publish** (environment `marketplace`, permissions `contents: read` and `id-token: write`) publishes
   that same VSIX with `vsce publish --oidc`. It does not rebuild.
3. **release** (`contents: write`) attaches the VSIX to the GitHub Release `vscode-vX.Y.Z`. If the release
   exists it uploads to it; if the asset is already there it does nothing; otherwise it creates the release
   with notes from the changelog, not marked as "Latest" (that label belongs to the Action's `v1.x`
   releases). It never overwrites an asset.

Runs for the same tag are serialized, so a version is never published twice at once. The jobs do not run
in forks.

The `v1.x` tags are the GitHub Action and project releases. They do not trigger this workflow.

## One-time setup: Marketplace Trusted Publishing

The workflow cannot publish until the Marketplace trusts it. This is configured by the publisher owner
in the Marketplace, not in this repository, and has not been done by the change that added the workflow.

1. Sign in to the [publisher management portal](https://marketplace.visualstudio.com/manage/publishers/prsurve)
   as an owner of the `prsurve` publisher.
2. Find the Trusted Publishing (federated credential) settings for the publisher and add a GitHub Actions
   policy. Menu labels may differ from this description; use whatever the portal calls it.
3. Enter these values exactly:

   | Field            | Value                |
   | ---------------- | -------------------- |
   | Repository owner | `prsurve`            |
   | Repository name  | `k8s-manifestlens`   |
   | Workflow file    | `publish-vscode.yml` |
   | Environment      | `marketplace`        |

4. In GitHub, open Settings, Environments, `marketplace` (it is created on the first run if missing). Optionally add
   yourself as a required reviewer so each publish waits for your approval, and restrict deployment to
   tags matching `vscode-v*`.

Until step 3 is done the publish job fails at authentication. Nothing else is harmed: the build job has
already proven the package, and you can re-run the failed job after fixing the policy.

## Open VSX (VSCodium, Cursor, Windsurf)

The same VSIX is also published to [Open VSX](https://open-vsx.org) by the `publish-open-vsx` job, after the
Marketplace publish and independent of the GitHub Release. It uses Open VSX trusted publishing (OIDC), so
there is no token in the workflow. The job is off until you finish the one-time setup below and set the
repository variable `OPEN_VSX_ENABLED` to `true`.

Open VSX requires the extension to exist before a trusted publisher can be added, so the first version is
uploaded by hand with a token. Do this once:

1. Sign in at open-vsx.org with GitHub, link an Eclipse Foundation account, and sign the Publisher Agreement
   (Settings, Profile).
2. Create an access token (Settings, Access Tokens).
3. Create the namespace and upload the current VSIX (keep the token out of logs and shell history):

   ```sh
   read -rs OVSX_PAT && export OVSX_PAT
   npx ovsx create-namespace prsurve
   npx ovsx publish packages/vscode/dist/k8s-manifestlens.vsix
   unset OVSX_PAT
   ```

   Open the namespace claim/verification flow in your Open VSX settings so it shows as verified. Only a
   verified namespace owner can add a trusted publisher.

4. In Open VSX, go to Settings, Trusted Publishers, choose the `prsurve` namespace, pick GitHub Actions, and
   enter owner `prsurve`, repository `k8s-manifestlens`, workflow `publish-vscode.yml`. Add no environment
   unless you add `environment:` to the job. Menu labels may differ; follow the portal.
5. Delete the access token.
6. Set the repository variable: `gh variable set OPEN_VSX_ENABLED --body true`

From the next `vscode-v*` tag on, Open VSX is published automatically. A version already on Open VSX cannot
be uploaded again, so the first automated run needs a new version number.

## Version strategy

The extension has its own version, independent of the Action (`v1.x`). The workflow never bumps it; you do,
in a pull request, before tagging.

- **Patch** (0.3.0 to 0.3.1): bug fixes and rule text changes.
- **Minor** (0.3.0 to 0.4.0): new commands, settings or checks.
- **Major**: breaking changes to settings or commands. While the version is 0.x, treat minor as the breaking level.

Marketplace versions are immutable. A published number cannot be reused, so a broken release is fixed by a
new patch version.

## Release a new version

```sh
git checkout main && git pull
git checkout -b release/vscode-0.3.1

# 1. Bump the version and add a "## 0.3.1" section to the changelog.
npm version 0.3.1 --no-git-tag-version -w k8s-manifestlens-vscode
$EDITOR packages/vscode/CHANGELOG.md

# 2. Run what CI runs.
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
npm run package -w k8s-manifestlens-vscode   # packages/vscode/dist/k8s-manifestlens.vsix

git commit -am "Release extension 0.3.1"
git push -u origin release/vscode-0.3.1       # open a PR and merge it

# 3. Tag the merge commit on main. The tag must match the version exactly.
git checkout main && git pull
git tag -a vscode-v0.3.1 -m "VS Code extension 0.3.1"
git push origin vscode-v0.3.1
```

Watch it with `gh run watch` or on the Actions tab.

## Get the VSIX

- From the GitHub Release: `gh release download vscode-v0.3.1 --pattern '*.vsix'`
- From the run: `gh run download <run-id> -n vsix` (kept 90 days)
- Install it: `code --install-extension k8s-manifestlens.vsix`

## Troubleshooting OIDC failures

| Symptom                                                   | Likely cause and fix                                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish job fails with an authentication or 401/403 error | No Trusted Publishing policy, or one of its values differs from the workflow: owner, repo, workflow filename or environment name. Compare each.                               |
| "Unable to get ACTIONS_ID_TOKEN_REQUEST_URL"              | The job lacks `id-token: write`, or it was copied into a workflow without it.                                                                                                 |
| Works on one tag, fails after renaming the workflow file  | The policy names the file. Update the policy when `publish-vscode.yml` is renamed.                                                                                            |
| `unknown option '--oidc'`                                 | vsce older than 4.0.2 is installed. Check `npx vsce --version`; the lockfile pins 4.1.1.                                                                                      |
| "version already exists"                                  | That version was published. Bump to a new version, retag. Do not reuse the number.                                                                                            |
| Tag check fails                                           | Read the error: wrong tag format, version mismatch, missing changelog heading, or tag not on `main`. Delete the tag (`git push origin :refs/tags/vscode-vX.Y.Z`), fix, retag. |

If the release job fails after a successful publish, use "Re-run failed jobs". Publish does not run again.

## Publish manually

Only if the workflow cannot be used. This needs a Personal Access Token, which the automated path avoids.
Create one for the `prsurve` publisher with the Marketplace "Manage" scope, then:

```sh
export VSCE_PAT=...            # do not commit or paste into logs
npm run publish:marketplace -w k8s-manifestlens-vscode
```

Or publish a VSIX you already built: `npx vsce publish --packagePath packages/vscode/dist/k8s-manifestlens.vsix`.
Revoke the token afterwards.
