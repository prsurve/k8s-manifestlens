import diffNew from '../../../examples/diff-new.yaml?raw';
import diffOld from '../../../examples/diff-old.yaml?raw';
import risky from '../../../examples/risky.yaml?raw';
import web from '../../../examples/web.yaml?raw';

export const examples = {
  explain: web,
  check: risky,
  diff: { old: diffOld, new: diffNew },
};
