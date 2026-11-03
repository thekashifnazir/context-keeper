// yaml: read the test set and demo content with the `yaml` package (YAML 1.2 core schema), so a
// clean clone needs no Python libraries. Timestamps stay strings, exactly as written (ISO 8601 in
// every file here), so Date.parse reads them.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export function loadYaml<T = unknown>(file: string): T {
  return parse(readFileSync(file, 'utf8')) as T;
}
