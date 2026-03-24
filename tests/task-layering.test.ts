import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(import.meta.dir, '..', relativePath), 'utf-8')
}

describe('task layering', () => {
  test('task service does not import task SQL helpers from db/index.ts directly', () => {
    const content = readProjectFile('src/task/service.ts')
    expect(content).not.toContain('createTask as')
    expect(content).not.toContain('getTasks,')
    expect(content).not.toContain('getTask,')
    expect(content).not.toContain('updateTask as')
    expect(content).not.toContain('deleteTask as')
  })

  test('task routes depend on task service exports instead of task SQL in db/index.ts', () => {
    const content = readProjectFile('src/routes/tasks.ts')
    expect(content).not.toContain("../db/index.ts")
    expect(content).not.toContain("./repository.ts")
  })

  test('task MCP server does not depend on task repository directly', () => {
    const content = readProjectFile('src/agent/task-mcp.ts')
    expect(content).not.toContain("./repository.ts")
  })
})
