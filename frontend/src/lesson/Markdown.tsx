import MarkdownIt from 'markdown-it'

// Raw HTML is escaped, not rendered (the backend also rejects it). Images wait
// for attachment references (slice 3), so the image rule is off.
const markdown = new MarkdownIt('commonmark', { html: false }).disable('image')

export function Markdown(props: { source: string; inline?: boolean }) {
  const html = () => (props.inline ? markdown.renderInline(props.source) : markdown.render(props.source))
  return props.inline ? <span innerHTML={html()} /> : <div class="markdown" innerHTML={html()} />
}
