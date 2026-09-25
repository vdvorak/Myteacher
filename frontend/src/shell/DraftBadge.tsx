import { useI18n } from '../i18n/i18n'

/** Whether the teacher saw to what the assistant produced: New until kept or edited, then Reviewed. */
export function DraftBadge(props: { reviewed: boolean }) {
  const { t } = useI18n()
  return (
    <span class="badge" data-tone={props.reviewed ? 'done' : 'attention'}>
      {t(props.reviewed ? 'drafts.reviewed' : 'drafts.new')}
    </span>
  )
}
