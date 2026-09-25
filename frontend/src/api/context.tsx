import { createContext, useContext, type ParentProps } from 'solid-js'
import { httpAdminApi, type AdminApi } from '../admin/api'
import { httpClassesApi, type ClassesApi } from '../classes/api'
import { httpConceptsApi, type ConceptsApi } from '../concepts/api'
import { httpCoursesApi, type CoursesApi } from '../courses/api'
import { httpDocumentsApi, type DocumentsApi } from '../documents/api'
import { httpJobsApi, type JobsApi } from '../jobs/api'
import { httpMaterialsApi, type MaterialsApi } from '../materials/api'
import { httpAuthApi, type AuthApi } from '../auth/api'
import { httpSettingsApi, type SettingsApi } from '../settings/api'
import { httpSourcesApi, type SourcesApi } from '../sources/api'
import { httpRunsApi, type RunsApi } from '../runs/api'
import { httpStudentsApi, type StudentsApi } from '../students/api'

/** Every backend the pages talk to; tests replace them with fakes. */
export interface Apis {
  auth: AuthApi
  admin: AdminApi
  settings: SettingsApi
  students: StudentsApi
  classes: ClassesApi
  runs: RunsApi
  courses: CoursesApi
  sources: SourcesApi
  concepts: ConceptsApi
  documents: DocumentsApi
  materials: MaterialsApi
  jobs: JobsApi
}

export const httpApis: Apis = {
  auth: httpAuthApi,
  admin: httpAdminApi,
  settings: httpSettingsApi,
  students: httpStudentsApi,
  classes: httpClassesApi,
  runs: httpRunsApi,
  courses: httpCoursesApi,
  sources: httpSourcesApi,
  concepts: httpConceptsApi,
  documents: httpDocumentsApi,
  materials: httpMaterialsApi,
  jobs: httpJobsApi,
}

const ApiContext = createContext<Apis>(httpApis)

export function ApiProvider(props: ParentProps<{ apis: Apis }>) {
  return <ApiContext.Provider value={props.apis}>{props.children}</ApiContext.Provider>
}

export function useApi(): Apis {
  return useContext(ApiContext)
}
