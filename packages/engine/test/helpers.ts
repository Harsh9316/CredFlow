import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { parsePolicy, type CreditPolicy } from '../src'

export const POLICIES_DIR = fileURLToPath(new URL('../../../policies/', import.meta.url))

export const readPolicyYaml = (file: string): unknown => parse(readFileSync(POLICIES_DIR + file, 'utf8'))
export const loadPolicy = (file: string): CreditPolicy => parsePolicy(readPolicyYaml(file))
export const policyFiles = () => readdirSync(POLICIES_DIR).filter(f => f.endsWith('.yaml'))
