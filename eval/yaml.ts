// yaml: read the test set and demo content. There's no YAML package in the build's dependencies
// (foundation lane; request in state/requests/eval.md), so this asks python3 + PyYAML, which
// testset/check_cases.py already needs. Timestamps come back as ISO strings.
import { execFileSync } from 'node:child_process';

const PY = `import json, sys, datetime, yaml
def d(o):
    if isinstance(o, (datetime.datetime, datetime.date)): return o.isoformat()
    raise TypeError(type(o))
print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8")), default=d))`;

export function loadYaml<T = unknown>(file: string): T {
  const out = execFileSync('python3', ['-c', PY, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as T;
}
