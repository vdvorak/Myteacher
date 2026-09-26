/** Page numbers as a teacher reads them, runs of pages joined: [2, 6, 7, 8] is "2, 6–8". */
export function pageRanges(pages: number[]): string {
  const runs: [number, number][] = []
  for (const page of pages) {
    const last = runs.at(-1)
    if (last && page === last[1] + 1) last[1] = page
    else runs.push([page, page])
  }
  return runs.map(([first, last]) => (first === last ? String(first) : `${first}–${last}`)).join(', ')
}
