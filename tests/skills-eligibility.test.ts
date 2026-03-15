import { describe, test, expect } from 'bun:test'
import { checkEligibility } from '../src/skills/eligibility.ts'

describe('checkEligibility', () => {
  test('returns eligible when there are no constraints', () => {
    const result = checkEligibility({
      name: 'demo',
      description: 'demo skill',
    })

    expect(result.eligible).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.detail.os.passed).toBe(true)
    expect(result.detail.dependencies.results).toEqual([])
    expect(result.detail.env.results).toEqual([])
  })

  test('returns error details when dependencies and env vars are missing', () => {
    delete process.env.YOUCLAW_TEST_REQUIRED_ENV

    const result = checkEligibility({
      name: 'demo',
      description: 'demo skill',
      dependencies: ['__youclaw_missing_binary__'],
      env: ['YOUCLAW_TEST_REQUIRED_ENV'],
    })

    expect(result.eligible).toBe(false)
    expect(result.errors.some((error) => error.includes('Missing dependency'))).toBe(true)
    expect(result.errors.some((error) => error.includes('Missing environment variable'))).toBe(true)
    expect(result.detail.dependencies.passed).toBe(false)
    expect(result.detail.dependencies.results[0]?.name).toBe('__youclaw_missing_binary__')
    expect(result.detail.dependencies.results[0]?.found).toBe(false)
    expect(result.detail.env.passed).toBe(false)
    expect(result.detail.env.results[0]).toEqual({ name: 'YOUCLAW_TEST_REQUIRED_ENV', found: false })
  })

  test('returns error when OS does not match', () => {
    const requiredOs = process.platform === 'darwin' ? ['linux'] : ['darwin']
    const result = checkEligibility({
      name: 'demo',
      description: 'demo skill',
      os: requiredOs,
    })

    expect(result.eligible).toBe(false)
    expect(result.errors[0]).toContain('OS mismatch')
    expect(result.detail.os.passed).toBe(false)
    expect(result.detail.os.required).toEqual(requiredOs)
    expect(result.detail.os.current).toBe(process.platform)
  })
})
