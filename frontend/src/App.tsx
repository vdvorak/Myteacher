import {
  MemoryRouter,
  Navigate,
  Route,
  Router,
  useParams,
  useSearchParams,
  type MemoryHistory,
  type RouteSectionProps,
} from '@solidjs/router'
import type { AuthApi } from './auth/api'
import { SessionProvider } from './auth/session'
import { SignInPage } from './auth/SignInPage'
import { PreviewPage } from './preview/PreviewPage'
import { HomePage } from './shell/HomePage'
import { Shell } from './shell/Shell'

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function PreviewRoute() {
  const params = useParams<{ lessonId: string }>()
  const [search] = useSearchParams<{ seed?: string }>()
  // The router hands over the segment still encoded; the lesson API encodes it again.
  return <PreviewPage lessonId={decodeSegment(params.lessonId)} seed={search.seed ?? 'preview'} />
}

const routes = () => (
  <>
    <Route path="/sign-in" component={SignInPage} />
    <Route path="/preview/:lessonId" component={PreviewRoute} />
    <Route path="/" component={Shell}>
      <Route path="/" component={HomePage} />
    </Route>
    <Route path="*" component={() => <Navigate href="/" />} />
  </>
)

/** The whole app; tests pass a memory history instead of the browser's. */
export function App(props: { auth: AuthApi; history?: MemoryHistory }) {
  const root = (section: RouteSectionProps) => (
    <SessionProvider api={props.auth}>{section.children}</SessionProvider>
  )
  return props.history ? (
    <MemoryRouter history={props.history} root={root}>
      {routes()}
    </MemoryRouter>
  ) : (
    <Router root={root}>{routes()}</Router>
  )
}
