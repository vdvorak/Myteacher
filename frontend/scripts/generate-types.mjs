// Generate TypeScript types from the backend's JSON Schema (schema/lesson.schema.json).
// Run through scripts/generate-schema.sh; the output is committed and diffed in CI.
import { readFile, writeFile } from 'node:fs/promises'
import { compile } from 'json-schema-to-typescript'

const [input, output] = process.argv.slice(2)
const schema = JSON.parse(await readFile(input, 'utf8'))

// Pydantic titles every property; json-schema-to-typescript would turn each into
// a named alias (Id, Title, ...). Keep titles only on the named definitions.
function stripPropertyTitles(node, keep) {
  if (Array.isArray(node)) return node.map((child) => stripPropertyTitles(child, false))
  if (node === null || typeof node !== 'object') return node
  const result = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'title' && typeof value === 'string' && !keep) continue
    if (key === '$defs' || key === 'properties') {
      // Maps from names to schemas: recurse into each schema, keep the names.
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, def]) => [name, stripPropertyTitles(def, key === '$defs')]),
      )
    } else {
      result[key] = stripPropertyTitles(value, false)
    }
  }
  return result
}

const ts = await compile(stripPropertyTitles(schema, true), 'LessonSchema', {
  bannerComment:
    '/* Generated from schema/lesson.schema.json by scripts/generate-schema.sh. Do not edit. */',
  unreachableDefinitions: true,
  additionalProperties: false,
  maxItems: -1,
  style: { singleQuote: true, semi: false },
})
await writeFile(output, ts)
