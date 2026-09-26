import { fakeAdminApi } from '../admin/testing'
import { fakeAttemptsApi } from '../attempts/testing'
import { fakeAuthApi } from '../auth/testing'
import { fakeClassesApi } from '../classes/testing'
import { fakeConceptsApi } from '../concepts/testing'
import { fakeCoursesApi } from '../courses/testing'
import { fakeDocumentsApi } from '../documents/testing'
import { fakeHomeApi } from '../home/testing'
import { fakeJobsApi } from '../jobs/testing'
import { fakeMaterialsApi } from '../materials/testing'
import { fakeParticipantsApi } from '../participants/testing'
import { fakeRunsApi } from '../runs/testing'
import { fakeSettingsApi } from '../settings/testing'
import { fakeSourcesApi } from '../sources/testing'
import { fakeStudentsApi } from '../students/testing'
import type { Apis } from './context'

/** Fakes for every backend, with the ones a test cares about passed in. */
export function fakeApis(overrides: Partial<Apis> = {}): Apis {
  return {
    auth: fakeAuthApi(),
    admin: fakeAdminApi(),
    settings: fakeSettingsApi(),
    students: fakeStudentsApi(),
    classes: fakeClassesApi(),
    runs: fakeRunsApi(),
    participants: fakeParticipantsApi(),
    attempts: fakeAttemptsApi(),
    courses: fakeCoursesApi(),
    sources: fakeSourcesApi(),
    concepts: fakeConceptsApi(),
    documents: fakeDocumentsApi(),
    materials: fakeMaterialsApi(),
    jobs: fakeJobsApi(),
    home: fakeHomeApi(),
    ...overrides,
  }
}
