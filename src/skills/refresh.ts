type SkillsChangeReason = 'watch' | 'manual'

let snapshotVersion = 0

function nextVersion(current: number): number {
  const now = Date.now()
  return now <= current ? current + 1 : now
}

export function bumpSkillsSnapshotVersion(reason: SkillsChangeReason = 'manual'): number {
  void reason
  snapshotVersion = nextVersion(snapshotVersion)
  return snapshotVersion
}

export function getSkillsSnapshotVersion(): number {
  return snapshotVersion
}

export function resetSkillsSnapshotVersion(): void {
  snapshotVersion = 0
}
