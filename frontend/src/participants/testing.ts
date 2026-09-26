import { vi } from 'vitest'
import type { JoinCheck, Participant, ParticipantsApi } from './api'

interface FakeLinkRun {
  runId: number
  run: string
  course: string
  joinToken: string
  capacity: number
  /** Who joined so far, each with the token of their personal link. */
  participants?: { name: string; token: string }[]
}

export const lobbyRun: FakeLinkRun = {
  runId: 7,
  run: 'Španělština – den otevřených dveří',
  course: 'Španělština 2.B',
  joinToken: 'join-7',
  capacity: 30,
}

/** A stand-in for joining link runs and reading a participant by their personal link. */
export function fakeParticipantsApi(options: { runs?: FakeLinkRun[] } = {}) {
  const runs = structuredClone(options.runs ?? [lobbyRun]).map((run) => ({
    ...run,
    participants: run.participants ?? [],
  }))
  const joined = '2026-09-25T08:05:00Z'
  const find = (token: string) => {
    for (const run of runs) {
      const index = run.participants.findIndex((p) => p.token === token)
      if (index >= 0) {
        const found: Participant = {
          id: 900 + index,
          name: run.participants[index].name,
          joined_at: joined,
          run_id: run.runId,
          run: run.run,
          course: { id: 1, name: run.course },
        }
        return found
      }
    }
    return null
  }
  return {
    check: vi.fn(async (joinToken: string): Promise<JoinCheck | null> => {
      const run = runs.find((r) => r.joinToken === joinToken)
      if (!run) return null
      return { run_id: run.runId, run: run.run, course: run.course, full: run.participants.length >= run.capacity }
    }),
    join: vi.fn(async (joinToken: string, name: string) => {
      const run = runs.find((r) => r.joinToken === joinToken)
      if (!run) return 'unknown_link' as const
      if (run.participants.length >= run.capacity) return 'run_full' as const
      const token = `personal-${run.runId}-${run.participants.length + 1}`
      run.participants.push({ name: name.trim(), token })
      return { token, participant: find(token)! }
    }),
    me: vi.fn(async (token: string) => find(token)),
  } satisfies ParticipantsApi
}
