import diffNew from '../../../examples/diff-new.yaml?raw';
import diffOld from '../../../examples/diff-old.yaml?raw';
import risky from '../../../examples/risky.yaml?raw';
import hardened from '../../../examples/hardened.yaml?raw';
import web from '../../../examples/web.yaml?raw';

/** Fix tab examples: the risk to allow, a policy to fill in when the fixes need one, and the manifest. */
export const fixExamples = {
  low: {
    risk: 'low',
    policy: '',
    text: `# Low risk: applied by default. The memory limit is held back until you give a value.
apiVersion: v1
kind: Pod
metadata:
  name: low-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        runAsNonRoot: true
`,
  },
  medium: {
    risk: 'medium',
    policy: 'params:\n  memoryLimit: 256Mi\n',
    text: `# Medium risk: runAsNonRoot can stop an image that runs as root, and the limit comes from the policy.
apiVersion: v1
kind: Pod
metadata:
  name: medium-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
`,
  },
  high: {
    risk: 'high',
    policy: '',
    text: `# High risk: a privileged container may need that access, so review the change.
apiVersion: v1
kind: Pod
metadata:
  name: high-risk
spec:
  containers:
    - name: app
      image: nginx:1.27
      securityContext:
        privileged: true
`,
  },
  none: { risk: 'low', policy: '', text: hardened },
} as const;

export const examples = {
  explain: web,
  check: risky,
  fix: risky,
  diff: { old: diffOld, new: diffNew },
};
