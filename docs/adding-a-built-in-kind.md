# Adding a built-in kind

A Kubernetes kind that k8s-manifestlens does not explain can be used on your own machine by
[importing its schema](kind-intelligence.md). To make it part of the tool for everyone, add it to the
generator and send a pull request. The browser never changes the repository for you.

## Steps

1. **Find the kind in the Kubernetes OpenAPI spec.** Download the spec for the version the dataset uses
   (see `version` in `packages/core/src/fields/generated/schema.ts`) and look for the definition name, for
   example `io.k8s.api.coordination.v1.Lease`.

   ```sh
   curl -fLo /tmp/swagger.json https://raw.githubusercontent.com/kubernetes/kubernetes/v1.37.1/api/openapi-spec/swagger.json
   grep -n '"io.k8s.api.coordination.v1.Lease"' /tmp/swagger.json
   ```

2. **Add it to `ROOTS`** in `packages/core/scripts/generate-schema.mjs`, keyed by kind:

   ```js
   Lease: 'io.k8s.api.coordination.v1.Lease',
   ```

   Use stable API versions only.

3. **Add it to the inventory** in `packages/core/src/kinds/inventory/built-in-inventory.ts` if it is not
   there yet, with its group, version and whether it is namespaced. This is how a kind is recognised as a real built-in. Whether it is covered comes from the generated dataset, so you do not mark that by hand.

4. **Regenerate the dataset.**

   ```sh
   npm run generate-schema -- --spec /tmp/swagger.json --version v1.37.1
   ```

5. **Add tests.** Extend `packages/core/test/schema.test.ts` with a few fields of the new kind, and check
   that `classifyKind` now reports it as supported (`packages/core/test/kinds.test.ts`).

6. **Run everything CI runs**, then commit the regenerated `schema.ts` and the rebuilt action bundle:

   ```sh
   npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
   ```

7. **Open a pull request.** Say which kind you added and which Kubernetes version it came from.

Hand-written explanations still win over generated ones. If you write a hand-written entry for the kind,
it takes precedence automatically.
