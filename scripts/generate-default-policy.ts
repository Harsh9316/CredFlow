// Regenerates packages/engine/src/default-policy.ts from policies/credflow-default.yaml,
// so the engine ships a default without depending on a YAML parser.
// Run: npm run policy:sync-default   (CI fails if the two drift apart)
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { parsePolicy } from '../packages/engine/src/policy'

const source = 'policies/credflow-default.yaml'
const raw = parse(readFileSync(source, 'utf8'))
parsePolicy(raw) // fail loudly if the file is invalid

const out = `// GENERATED from ${source} by scripts/generate-default-policy.ts. Do not edit by hand.
import type { CreditPolicyInput } from './policy'

export const DEFAULT_POLICY_INPUT: CreditPolicyInput = ${JSON.stringify(raw, null, 2)}
`
writeFileSync('packages/engine/src/default-policy.ts', out)
console.log(`wrote packages/engine/src/default-policy.ts from ${source}`)
