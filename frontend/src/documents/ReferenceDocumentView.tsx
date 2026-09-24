import { For, Show } from 'solid-js'
import { useI18n } from '../i18n/i18n'
import { Markdown } from '../lesson/Markdown'
import type { Citation, ReferenceDocument } from './api'
import './documents.css'

interface Footnote {
  number: number
  citation: Citation
}

/** One number per distinct source and location, in the order they are first cited. */
function footnotesOf(document: ReferenceDocument): { list: Footnote[]; numberOf: (c: Citation) => number } {
  const key = (c: Citation) => `${c.source_id}\u0000${c.location}`
  const numbers = new Map<string, Footnote>()
  for (const passage of document.passages) {
    for (const citation of passage.citations) {
      if (!numbers.has(key(citation))) numbers.set(key(citation), { number: numbers.size + 1, citation })
    }
  }
  return { list: [...numbers.values()], numberOf: (c) => numbers.get(key(c))!.number }
}

/** A reference document as read and printed: its passages, their footnotes and the unsourced marks. */
export function ReferenceDocumentView(props: { document: ReferenceDocument }) {
  const { t } = useI18n()
  const footnotes = () => footnotesOf(props.document)

  return (
    <div class="reference-document">
      <h1>{props.document.title}</h1>
      <Show when={props.document.unsourced_passages > 0}>
        <p class="unsourced-note">
          {props.document.unsourced_passages === 1
            ? t('documents.unsourcedOne')
            : t('documents.unsourcedMany', { count: props.document.unsourced_passages })}
        </p>
      </Show>
      <For each={props.document.passages}>
        {(passage, index) => (
          <article
            class="passage"
            classList={{ unsourced: passage.unsourced }}
            aria-label={t('documents.passage', { n: index() + 1 })}
          >
            <Markdown source={passage.markdown} />
            <Show
              when={!passage.unsourced}
              fallback={<span class="unsourced-mark">{t('documents.unsourced')}</span>}
            >
              <p class="passage-citations">
                <For each={passage.citations}>
                  {(citation) => {
                    const number = footnotes().numberOf(citation)
                    return (
                      <sup>
                        <a href={`#footnote-${number}`}>{number}</a>
                      </sup>
                    )
                  }}
                </For>
              </p>
            </Show>
          </article>
        )}
      </For>
      <Show when={footnotes().list.length > 0}>
        <ol class="footnotes" aria-label={t('documents.sources')}>
          <For each={footnotes().list}>
            {(footnote) => (
              <li id={`footnote-${footnote.number}`}>
                {footnote.citation.source_name ?? t('documents.removedSource')}, {footnote.citation.location}
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  )
}
