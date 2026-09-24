// The real fixture lessons, in the public form the API serves (generated into schema/fixtures).
import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import allTypes from '../../../schema/fixtures/all-exercise-types.public.json'
import irregularVerbs from '../../../schema/fixtures/en-irregular-verbs.public.json'
import vocabulary from '../../../schema/fixtures/es-vocabulario.public.json'
import atTheEnd from '../../../schema/fixtures/en-present-perfect.public.json'
import immediate from '../../../schema/fixtures/es-ser-estar.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { isRendered } from '../lesson/schema'
import { fakeApi, withI18n } from '../lesson/testing'

const fixtures = [allTypes, atTheEnd, immediate, irregularVerbs, vocabulary] as LessonPublic[]

function preview(lesson: LessonPublic, locale: 'en' | 'cs' = 'en') {
  return render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={fakeApi(lesson)} />, locale))
}

describe('fixture lessons in the preview', () => {
  it.each(fixtures.map((lesson) => [lesson.id, lesson]))('renders %s', (_, lesson) => {
    const { container } = preview(lesson)

    expect(screen.getByRole('heading', { level: 1, name: lesson.title })).toBeInTheDocument()
    const exercises = lesson.blocks.filter((block) => block.type !== 'explanation')
    expect(container.querySelectorAll('.exercise')).toHaveLength(exercises.length)
  })

  it('renders every type of the all-types fixture, with placeholders for those without a renderer', () => {
    const lesson = allTypes as LessonPublic
    preview(lesson)

    const unrendered = lesson.blocks.filter((block) => block.type !== 'explanation' && !isRendered(block))
    expect(unrendered.length).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByRole('note', { name: /: not supported yet$/ })).toHaveLength(unrendered.length)
    expect(screen.getByRole('group', { name: /estación/ })).toBeInTheDocument()
  })

  it('renders the all-types placeholders in Czech', () => {
    preview(allTypes as LessonPublic, 'cs')

    expect(screen.getAllByRole('note', { name: /: zatím nepodporováno$/ })).toHaveLength(5)
  })
})
