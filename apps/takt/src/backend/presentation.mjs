export function definitionPresentation(record) {
  return { ...record, presentation: { title: `${record.title} · 修订 ${record.revision}`, route: `moss-app://moss.takt/flows/${record.id}?revision=${record.revision}` } }
}
export function runPresentation(run) {
  return { ...run, presentation: { title: run.title, route: `moss-app://moss.takt/runs/${run.id}` } }
}
