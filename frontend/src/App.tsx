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
import { AdminPage } from './admin/AdminPage'
import { ClassesPage } from './classes/ClassesPage'
import { ClassPage } from './classes/ClassPage'
import { ApiProvider, type Apis } from './api/context'
import { SessionProvider } from './auth/session'
import { ForgotPasswordPage } from './auth/ForgotPasswordPage'
import { InvitationPage, ResetPasswordPage } from './auth/PasswordLinkPage'
import { SignInPage } from './auth/SignInPage'
import { PreviewPage } from './preview/PreviewPage'
import { HomePage } from './shell/HomePage'
import { Shell } from './shell/Shell'
import { SettingsPage } from './settings/SettingsPage'
import { StudentPage } from './students/StudentPage'
import { StudentsPage } from './students/StudentsPage'

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
    <Route path="/invitation" component={InvitationPage} />
    <Route path="/forgot-password" component={ForgotPasswordPage} />
    <Route path="/reset-password" component={ResetPasswordPage} />
    <Route path="/preview/:lessonId" component={PreviewRoute} />
    <Route path="/" component={Shell}>
      <Route path="/" component={HomePage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/students" component={StudentsPage} />
      <Route path="/students/:studentId" component={StudentPage} />
      <Route path="/classes" component={ClassesPage} />
      <Route path="/classes/:classId" component={ClassPage} />
      <Route path="/admin" component={AdminPage} />
    </Route>
    <Route path="*" component={() => <Navigate href="/" />} />
  </>
)

/** The whole app; tests pass a memory history instead of the browser's. */
export function App(props: { apis: Apis; history?: MemoryHistory }) {
  const root = (section: RouteSectionProps) => (
    <ApiProvider apis={props.apis}>
      <SessionProvider>{section.children}</SessionProvider>
    </ApiProvider>
  )
  return props.history ? (
    <MemoryRouter history={props.history} root={root}>
      {routes()}
    </MemoryRouter>
  ) : (
    <Router root={root}>{routes()}</Router>
  )
}
