import { createContext, useContext, type ParentProps } from 'solid-js'
import { httpAdminApi, type AdminApi } from '../admin/api'
import { httpAuthApi, type AuthApi } from '../auth/api'
import { httpSettingsApi, type SettingsApi } from '../settings/api'

/** Every backend the pages talk to; tests replace them with fakes. */
export interface Apis {
  auth: AuthApi
  admin: AdminApi
  settings: SettingsApi
}

export const httpApis: Apis = { auth: httpAuthApi, admin: httpAdminApi, settings: httpSettingsApi }

const ApiContext = createContext<Apis>(httpApis)

export function ApiProvider(props: ParentProps<{ apis: Apis }>) {
  return <ApiContext.Provider value={props.apis}>{props.children}</ApiContext.Provider>
}

export function useApi(): Apis {
  return useContext(ApiContext)
}
