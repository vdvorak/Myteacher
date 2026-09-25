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
import { WorkPage } from './attempts/WorkPage'
import { ClassesPage } from './classes/ClassesPage'
import { ClassPage } from './classes/ClassPage'
import { ConceptMapPage } from './concepts/ConceptMapPage'
import { CoursePage } from './courses/CoursePage'
import { CoursesPage } from './courses/CoursesPage'
import { DocumentPreviewPage } from './documents/DocumentPreviewPage'
import { MaterialPreviewPage } from './materials/MaterialPreviewPage'
import { ApiProvider, type Apis } from './api/context'
import { SessionProvider } from './auth/session'
import { ForgotPasswordPage } from './auth/ForgotPasswordPage'
import { InvitationPage, ResetPasswordPage } from './auth/PasswordLinkPage'
import { SignInPage } from './auth/SignInPage'
import { PreviewPage } from './preview/PreviewPage'
import { ReleaseResultsPage } from './runs/ReleaseResultsPage'
import { RunPage } from './runs/RunPage'
import { RunsPage } from './runs/RunsPage'
import { StudentResultsPage } from './runs/StudentResultsPage'
import { HomePage } from './shell/HomePage'
import { ConfirmProvider } from './shell/confirm'
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
      <Route path="/preview/courses/:courseId/topics/:topicId/documents/:documentId" component={DocumentPreviewPage} />
      <Route path="/preview/courses/:courseId/topics/:topicId/materials/:materialId" component={MaterialPreviewPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/students" component={StudentsPage} />
      <Route path="/students/:studentId" component={StudentPage} />
      <Route path="/classes" component={ClassesPage} />
      <Route path="/classes/:classId" component={ClassPage} />
      <Route path="/courses" component={CoursesPage} />
      <Route path="/courses/:courseId" component={CoursePage} />
      <Route path="/courses/:courseId/topics/:topicId" component={ConceptMapPage} />
      <Route path="/runs" component={RunsPage} />
      <Route path="/runs/:runId" component={RunPage} />
      <Route path="/runs/:runId/releases/:releaseId" component={ReleaseResultsPage} />
      <Route path="/runs/:runId/releases/:releaseId/students/:studentId" component={StudentResultsPage} />
      <Route path="/work/:releaseId" component={WorkPage} />
      <Route path="/admin" component={AdminPage} />
    </Route>
    <Route path="*" component={() => <Navigate href="/" />} />
  </>
)

/** The whole app; tests pass a memory history instead of the browser's. */
export function App(props: { apis: Apis; history?: MemoryHistory }) {
  const root = (section: RouteSectionProps) => (
    <ApiProvider apis={props.apis}>
      <SessionProvider>
        <ConfirmProvider page={() => section.location.pathname}>{section.children}</ConfirmProvider>
      </SessionProvider>
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
