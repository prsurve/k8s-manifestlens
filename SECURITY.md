# Security policy

k8s-manifestlens is local-first: the CLI, the VS Code extension and the web page analyze manifests on your machine, and the GitHub Action reads files inside the checked-out repository. Reports I am most interested in:

- a way for a crafted manifest, CRD, rules file or glob to run code, read files outside the repository, or hang the tool
- the web page sending manifest content anywhere
- the GitHub Action leaking a token, or acting outside the permissions its workflow grants
- the `fix` command changing files without `--write`

## Reporting a problem

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Please do not open a public issue with details.

A small manifest that shows the problem is enough. Do not include real secrets or cluster credentials.

## Supported versions

Only the latest release of the Action, CLI and VS Code extension gets fixes. This is a small project, so there is no fixed response time, but reports that affect the Action or the web page are handled first.
