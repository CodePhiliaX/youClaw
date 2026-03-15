export interface ParsedMessage {
  requestedSkills: string[]  // Extracted skill names
  cleanContent: string       // Plain text with /<skill> tokens removed
}

/**
 * Parse /<skill-name> invocation syntax in a message.
 * - Matches consecutive /<word> tokens at the start of the message
 * - Only recognizes <word> as a skill invocation if it exists in knownSkillNames
 * - Unknown /<word> tokens are preserved in cleanContent
 */
export function parseSkillInvocations(
  content: string,
  knownSkillNames: Set<string>,
): ParsedMessage {
  const requestedSkills: string[] = []
  const remaining: string[] = []

  // Split tokens by whitespace
  const tokens = content.split(/\s+/)
  let parsingSkills = true

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (parsingSkills && token.startsWith('/')) {
      const skillName = token.slice(1)
      if (knownSkillNames.has(skillName)) {
        requestedSkills.push(skillName)
        continue
      }
    }
    // Stop parsing prefix after encountering a non-skill token (preserve current token)
    parsingSkills = false
    remaining.push(token)
  }

  return {
    requestedSkills,
    cleanContent: remaining.join(' '),
  }
}
