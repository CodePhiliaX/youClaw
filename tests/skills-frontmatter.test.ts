import { describe, test, expect } from 'bun:test'
import { parseFrontmatter } from '../src/skills/frontmatter.ts'

describe('parseFrontmatter', () => {
  test('parses complete frontmatter and preserves body content', () => {
    const raw = `
---
name: pdf
description: Read and summarize PDFs
version: 1.2.0
os: [darwin, linux]
dependencies: [pdftotext]
env: [OPENAI_API_KEY]
tools: [render]
tags: [docs, extraction]
globs: ["**/*.pdf"]
priority: critical
install:
  brew: brew install poppler
  apt: apt install poppler-utils
---
# Usage

Run this skill on uploaded PDF files.
`

    const parsed = parseFrontmatter(raw)

    expect(parsed.frontmatter).toEqual({
      name: 'pdf',
      description: 'Read and summarize PDFs',
      version: '1.2.0',
      os: ['darwin', 'linux'],
      dependencies: ['pdftotext'],
      env: ['OPENAI_API_KEY'],
      tools: ['render'],
      tags: ['docs', 'extraction'],
      globs: ['**/*.pdf'],
      priority: 'critical',
      install: {
        brew: 'brew install poppler',
        apt: 'apt install poppler-utils',
      },
    })
    expect(parsed.content).toBe('# Usage\n\nRun this skill on uploaded PDF files.')
  })

  test('install values are coerced to strings, invalid priority is ignored', () => {
    const raw = `
---
name: mixed
description: Test parser coercion
priority: urgent
install:
  npm: 123
---
Body
`

    const parsed = parseFrontmatter(raw)

    expect(parsed.frontmatter.priority).toBeUndefined()
    expect(parsed.frontmatter.install).toEqual({ npm: '123' })
    expect(parsed.content).toBe('Body')
  })

  test('throws when opening frontmatter is missing', () => {
    expect(() => parseFrontmatter('name: invalid')).toThrow('SKILL.md missing frontmatter')
  })

  test('throws when frontmatter is not closed', () => {
    expect(() => parseFrontmatter('---\nname: demo\ndescription: test')).toThrow('SKILL.md frontmatter not closed')
  })

  test('throws when required fields are missing', () => {
    expect(() => parseFrontmatter('---\ndescription: only description\n---\nBody')).toThrow('SKILL.md frontmatter missing required field: name')
    expect(() => parseFrontmatter('---\nname: only-name\n---\nBody')).toThrow('SKILL.md frontmatter missing required field: description')
  })
})
