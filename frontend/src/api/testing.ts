import { fakeAdminApi } from '../admin/testing'
import { fakeAuthApi } from '../auth/testing'
import { fakeClassesApi } from '../classes/testing'
import { fakeCoursesApi } from '../courses/testing'
import { fakeSettingsApi } from '../settings/testing'
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
    courses: fakeCoursesApi(),
    ...overrides,
  }
}
