import { LineCounter, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { Document, Node, ParsedNode, YAMLMap } from 'yaml';
import type { FieldNode, ManifestDocument, ParseIssue } from './types.js';

/** A parsed document together with the YAML syntax tree it came from, for tools that edit the source. */
export interface ParsedWithTree {
  manifest: ManifestDocument;
  tree: Document.Parsed;
}

/** Parse a multi-document YAML manifest, keeping the source line of every key. */
export function parseManifest(source: string): ManifestDocument[] {
  return parseManifestWithTree(source).map((d) => d.manifest);
}

/** Like {@link parseManifest}, but also returns each document's syntax tree (with source offsets). */
export function parseManifestWithTree(source: string): ParsedWithTree[] {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(source, { lineCounter, prettyErrors: false, merge: true });

  const result: ParsedWithTree[] = [];
  docs.forEach((doc) => {
    const issues: ParseIssue[] = [...doc.errors, ...doc.warnings].map((e) => ({
      message: e.message.split('\n')[0] ?? e.message,
      line: lineCounter.linePos(e.pos[0]).line,
    }));

    const root = doc.contents;
    // Skip empty documents, e.g. a leading `---` or a trailing separator.
    const isEmpty = root === null || (isScalar(root) && root.value === null);
    if (isEmpty && issues.length === 0) return;

    const fields: FieldNode[] = [];
    if (isMap(root)) {
      collect(root, '', '', 0, lineCounter, fields);
    } else if (!isEmpty) {
      issues.push({
        message: 'Expected a mapping at the top level of a Kubernetes manifest.',
        line: lineOf(root, lineCounter),
      });
    }

    result.push({
      tree: doc,
      manifest: {
        index: result.length,
        startLine: isEmpty ? 1 : lineOf(root, lineCounter),
        ...topLevelScalars(root),
        ...(isMap(root) ? { data: doc.toJS() as Record<string, unknown> } : {}),
        fields,
        issues,
      },
    });
  });
  return result;
}

function lineOf(node: Node | ParsedNode | null | undefined, lc: LineCounter): number {
  const offset = node?.range?.[0];
  return offset === undefined ? 1 : lc.linePos(offset).line;
}

function topLevelScalars(root: unknown): Pick<ManifestDocument, 'apiVersion' | 'kind' | 'name'> {
  if (!isMap(root)) return {};
  const str = (v: unknown): string | undefined =>
    isScalar(v) && typeof v.value === 'string' ? v.value : undefined;
  const metadata = root.get('metadata', true);
  const out: Pick<ManifestDocument, 'apiVersion' | 'kind' | 'name'> = {};
  const apiVersion = str(root.get('apiVersion', true));
  const kind = str(root.get('kind', true));
  const name = isMap(metadata) ? str(metadata.get('name', true)) : undefined;
  if (apiVersion !== undefined) out.apiVersion = apiVersion;
  if (kind !== undefined) out.kind = kind;
  if (name !== undefined) out.name = name;
  return out;
}

function collect(
  map: YAMLMap,
  pathPrefix: string,
  patternPrefix: string,
  depth: number,
  lc: LineCounter,
  out: FieldNode[],
): void {
  for (const pair of map.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    // `<<: *base` merges another mapping in; it is not a field of its own.
    if (key === '<<') continue;
    const path = join(pathPrefix, key);
    const pat = join(patternPrefix, key);
    const keyOffset = pair.key.range?.[0] ?? 0;
    const pos = lc.linePos(keyOffset);
    const value = pair.value;

    const node: FieldNode = {
      path,
      pattern: pat,
      key,
      line: pos.line,
      column: pos.col,
      depth,
      type: isMap(value) ? 'map' : isSeq(value) ? 'list' : 'scalar',
    };
    if (isScalar(value) && value.value !== null && value.value !== undefined) {
      node.value = String(value.value);
    }
    out.push(node);

    if (isMap(value)) {
      collect(value, path, pat, depth + 1, lc, out);
    } else if (isSeq(value)) {
      value.items.forEach((item, i) => {
        if (isMap(item)) {
          collect(item, `${path}[${i}]`, `${pat}[]`, depth + 1, lc, out);
        }
      });
    }
  }
}

function join(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}
