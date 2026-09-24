import { createContext, createSignal, onMount, useContext, type ParentProps } from 'solid-js'
import { useApi } from '../api/context'
import { browserLocale, useI18n } from '../i18n/i18n'
import type { AcceptResult, Account, SignInResult } from './api'

interface Session {
  /** The signed-in account, null when anonymous, undefined while it is being found out. */
  account(): Account | null | undefined
  /** Finding out who is signed in failed, for example because the server was unreachable. */
  loadFailed(): boolean
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
  /** Set the first password through an invitation, which also signs in. */
  acceptInvitation(token: string, password: string): Promise<AcceptResult>
  /** Replace the signed-in account after it changed, for example its language. */
  updateAccount(account: Account): void
}

const SessionContext = createContext<Session>()

export function SessionProvider(props: ParentProps) {
  const api = useApi().auth
  const { setLocale } = useI18n()
  const [account, setSignedIn] = createSignal<Account | null | undefined>(undefined)
  // The account's language wins over the browser's, on every device it signs in from.
  // An account without a language, or signing out, returns a shared device to the browser's.
  const setAccount = (next: Account | null) => {
    const previous = account()
    if (next?.language) setLocale(next.language)
    else if (previous) setLocale(browserLocale())
    setSignedIn(next)
  }
  const [loadFailed, setLoadFailed] = createSignal(false)
  onMount(() => {
    api.me().then(setAccount, () => setLoadFailed(true))
  })
  const session: Session = {
    account,
    loadFailed,
    async signIn(email, password) {
      const result = await api.signIn(email, password)
      if (typeof result !== 'string') {
        setLoadFailed(false)
        setAccount(result)
      }
      return result
    },
    async acceptInvitation(token, password) {
      const result = await api.acceptInvitation(token, password)
      if (typeof result !== 'string') {
        setLoadFailed(false)
        setAccount(result)
      }
      return result
    },
    async signOut() {
      await api.signOut()
      setAccount(null)
    },
    updateAccount: setAccount,
  }
  return <SessionContext.Provider value={session}>{props.children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside a SessionProvider')
  return session
}
