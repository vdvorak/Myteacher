import { createContext, useContext, type ParentProps } from 'solid-js'

/** Where the work pages lead: the signed-in student's, or a participant's behind their personal link. */
export interface WorkLinks {
  home: string
  work(releaseId: number): string
}

const WorkLinksContext = createContext<WorkLinks>({ home: '/', work: (releaseId) => `/work/${releaseId}` })

export function WorkLinksProvider(props: ParentProps<{ links: WorkLinks }>) {
  return <WorkLinksContext.Provider value={props.links}>{props.children}</WorkLinksContext.Provider>
}

export function useWorkLinks(): WorkLinks {
  return useContext(WorkLinksContext)
}
