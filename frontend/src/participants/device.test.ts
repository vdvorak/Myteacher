import { afterEach, describe, expect, it, vi } from 'vitest'
import { thisDevice } from './device'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('the device', () => {
  it('stays the same device across calls', () => {
    expect(thisDevice()).toBe(thisDevice())
    expect(localStorage.getItem('myteacher.device')).toBe(thisDevice())
  })

  it('lasts as long as the tab where local storage is blocked, so a reload is the same device', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    const device = thisDevice()

    expect(sessionStorage.getItem('myteacher.device')).toBe(device)
    expect(thisDevice()).toBe(device)
  })
})
