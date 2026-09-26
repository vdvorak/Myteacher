// What names this browser to the server, as a participant's work is open on one device at a time
// (ADR 0012). Made up once and kept; where local storage is blocked, it lasts as long as the tab,
// so a reload does not look like another device, and without any storage until the page is reloaded.
const key = 'myteacher.device'

const madeUp = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

let unstored: string | undefined

function kept(storage: () => Storage): string | null {
  try {
    const stored = storage().getItem(key)
    if (stored) return stored
    const made = madeUp()
    storage().setItem(key, made)
    return made
  } catch {
    return null
  }
}

export function thisDevice(): string {
  return kept(() => localStorage) ?? kept(() => sessionStorage) ?? (unstored ??= madeUp())
}
