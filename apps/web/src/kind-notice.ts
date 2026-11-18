import { classifyKind, findBuiltIn, splitApiVersion, supportedKinds } from '@k8s-manifestlens/core';
import { el } from './dom.js';

/** Fired (and bubbled) when the user asks to add support for a kind; main.ts opens the wizard. */
export const ONBOARD_EVENT = 'kind-onboard';
export interface OnboardDetail {
  kind: string;
  apiVersion: string | undefined;
}

/** The notice under a document whose kind has no explanations: what it is, and what to do about it. */
export function kindNotice(kind: string, apiVersion: string | undefined): HTMLElement {
  const c = classifyKind(kind, apiVersion);
  const lead = `No field explanations for kind "${kind}" yet`;
  let text: string;
  let action: string | undefined;
  if (c.category === 'missing-builtin') {
    const b = findBuiltIn(kind).find((x) => x.group === splitApiVersion(apiVersion ?? '').group);
    text = `${lead}. It is a built-in Kubernetes kind (${b ? (b.group ? `${b.group}/${b.version}` : b.version) : 'core'}) that ManifestLens does not cover yet.`;
    action = 'Add support';
  } else if (c.category === 'custom') {
    text = `${lead}. ${apiVersion ?? ''} is a custom resource: import its CRD or OpenAPI schema to explain and check it.`;
    action = 'Import schema';
  } else if (c.category === 'malformed') {
    text = `${lead}: ${c.reason ?? 'the resource identity is not valid.'}`;
  } else {
    text = `${lead} (supported: ${supportedKinds().join(', ')}). It is not a known Kubernetes kind, so check the spelling, or import a schema if it is a custom resource.`;
    action = 'Import schema';
  }
  const button = action && el('button', { class: 'btn', text: action, attrs: { type: 'button' } });
  if (button) {
    button.addEventListener('click', () =>
      button.dispatchEvent(
        new CustomEvent<OnboardDetail>(ONBOARD_EVENT, {
          bubbles: true,
          detail: { kind, apiVersion },
        }),
      ),
    );
  }
  return el('p', { class: 'issue kind-notice' }, [text, ' ', button]);
}
