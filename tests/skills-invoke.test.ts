import { describe, test, expect } from 'bun:test'
import { parseSkillInvocations } from '../src/skills/invoke.ts'

describe('parseSkillInvocations', () => {
  test('extracts consecutive known skills at the beginning and returns cleaned body', () => {
    const parsed = parseSkillInvocations(
      '/pdf /agent-browser summarize this page',
      new Set(['pdf', 'agent-browser']),
    )

    expect(parsed).toEqual({
      requestedSkills: ['pdf', 'agent-browser'],
      cleanContent: 'summarize this page',
    })
  })

  test('stops parsing at unknown /token and preserves remaining content', () => {
    const parsed = parseSkillInvocations(
      '/unknown /pdf keep everything',
      new Set(['pdf']),
    )

    expect(parsed).toEqual({
      requestedSkills: [],
      cleanContent: '/unknown /pdf keep everything',
    })
  })

  test('/skill in the body text is not treated as invocation syntax', () => {
    const parsed = parseSkillInvocations(
      'please use /pdf on this document',
      new Set(['pdf']),
    )

    expect(parsed).toEqual({
      requestedSkills: [],
      cleanContent: 'please use /pdf on this document',
    })
  })

  test('cleanContent is empty string when only skill prefixes are present', () => {
    const parsed = parseSkillInvocations('/pdf /agent-browser', new Set(['pdf', 'agent-browser']))

    expect(parsed).toEqual({
      requestedSkills: ['pdf', 'agent-browser'],
      cleanContent: '',
    })
  })
})
