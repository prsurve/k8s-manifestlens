/**
 * Cheap guard so ordinary YAML files (CI configs, Helm templates, docker-compose) are left alone:
 * only text that declares both `apiVersion` and `kind` at the top level counts as a Kubernetes manifest.
 */
export function looksLikeKubernetes(text: string): boolean {
  return /^apiVersion:\s*\S/m.test(text) && /^kind:\s*\S/m.test(text) && !text.includes('{{');
}
