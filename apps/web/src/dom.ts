/** Small DOM helpers. Text is always set with textContent, so user YAML can never become markup. */
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** A link to the official Kubernetes docs. Anything else is shown as plain text. */
export function docsLink(url: string): HTMLElement {
  if (!url.startsWith('https://kubernetes.io/docs/')) return el('span', { text: url });
  return el('a', {
    class: 'docs',
    text: 'Docs',
    attrs: { href: url, rel: 'noopener noreferrer', target: '_blank' },
  });
}
