// The personal links this browser was given, by run, so opening the join link again brings the
// participant back instead of joining twice. Storage may be unavailable; then nothing is remembered.
const key = (runId: number) => `myteacher.participant.${runId}`

export function remember(runId: number, token: string): void {
  try {
    localStorage.setItem(key(runId), token)
  } catch {
    // Private window or blocked storage: the personal link itself still works.
  }
}

export function rememberedFor(runId: number): string | null {
  try {
    return localStorage.getItem(key(runId))
  } catch {
    return null
  }
}

/** Forgets a personal link that no longer works, whichever run it was for. */
export function forget(token: string): void {
  try {
    for (const stored of Object.keys(localStorage)) {
      if (stored.startsWith('myteacher.participant.') && localStorage.getItem(stored) === token) {
        localStorage.removeItem(stored)
      }
    }
  } catch {
    // Nothing was remembered.
  }
}
