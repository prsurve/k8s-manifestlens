# ManifestLens plan

## Open decisions

1. **Language:** TypeScript (decided 2026-10-17): web-based, one core reused by CLI, web page and editor plugin.
2. **First interface:** CLI first, then web page and editor plugin on the same core.
3. **Rules format:** declarative YAML/JSON rule files so the community can add rules without writing code.
4. **Explanations source:** a bundled field-description dataset generated from the Kubernetes OpenAPI spec, so it works offline.
5. **License:** Apache-2.0 (common in the CNCF world) unless decided otherwise.

## Milestones

- M1 (done): parse a manifest, explain each field (hand-written dataset; OpenAPI-generated dataset still to do)
- M2 (done): rule engine with 16 starter rules (resources, securityContext, image tags, probes)
- M3 (done): docs links per field, diff mode
- M4 (web page done, deploy to Vercel pending; editor plugin next): web page (static, runs in the browser) and editor plugin
