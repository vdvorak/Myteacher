import { createContext, createSignal, onMount, useContext, type ParentProps } from 'solid-js'
import type { Account, AuthApi, SignInResult } from './api'

interface Session {
  /** The signed-in account, null when anonymous, undefined while it is being found out. */
  account(): Account | null | undefined
  /** Finding out who is signed in failed, for example because the server was unreachable. */
  loadFailed(): boolean
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
}

const SessionContext = createContext<Session>()

export function SessionProvider(props: ParentProps<{ api: AuthApi }>) {
  const [account, setAccount] = createSignal<Account | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = createSignal(false)
  onMount(() => {
    props.api.me().then(setAccount, () => setLoadFailed(true))
  })
  const session: Session = {
    account,
    loadFailed,
    async signIn(email, password) {
      const result = await props.api.signIn(email, password)
      if (typeof result !== 'string') {
        setLoadFailed(false)
        setAccount(result)
      }
      return result
    },
    async signOut() {
      await props.api.signOut()
      setAccount(null)
    },
  }
  return <SessionContext.Provider value={session}>{props.children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside a SessionProvider')
  return session
}
