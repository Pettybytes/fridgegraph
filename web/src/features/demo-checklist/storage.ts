export function checklistStorageKey(version: string, personaId: string, childId: string, demoRunId: string) {
  return `fg:judge-checklist:${JSON.stringify([version, personaId, childId, demoRunId])}`
}
