// The real fixture lessons, in the public form the API serves (generated into schema/fixtures).
import { render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import allTypes from '../../../schema/fixtures/all-exercise-types.public.json'
import atTheEnd from '../../../schema/fixtures/en-present-perfect.public.json'
import immediate from '../../../schema/fixtures/es-ser-estar.public.json'
import type { LessonPublic } from '../generated/lesson'
import { LessonPlayer } from '../lesson/LessonPlayer'
import { fakeApi, withI18n } from '../lesson/testing'

const fixtures = [allTypes, atTheEnd, immediate] as LessonPublic[]

function preview(lesson: LessonPublic, locale: 'en' | 'cs' = 'en') {
  render(withI18n(() => <LessonPlayer lesson={lesson} seed="1" api={fakeApi(lesson)} />, locale))
}

describe('fixture lessons in the preview', () => {
  it.each(fixtures.map((lesson) => [lesson.id, lesson]))('renders %s', (_, lesson) => {
    preview(lesson)

    expect(screen.getByRole('heading', { level: 1, name: lesson.title })).toBeInTheDocument()
    const exercises = lesson.blocks.filter((block) => block.type !== 'explanation')
    expect(screen.queryAllByRole('group').length + screen.queryAllByRole('note').length).toBe(exercises.length)
  })

  it('renders every type of the all-types fixture, with placeholders for those without a renderer', () => {
    const lesson = allTypes as LessonPublic
    preview(lesson)

    const unrendered = lesson.blocks.filter(
      (block) => block.type !== 'explanation' && block.type !== 'multiple_choice',
    )
    expect(unrendered.length).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByRole('note', { name: /: not supported yet$/ })).toHaveLength(unrendered.length)
    expect(screen.getByRole('group', { name: /estación/ })).toBeInTheDocument()
  })

  it('renders the all-types placeholders in Czech', () => {
    preview(allTypes as LessonPublic, 'cs')

    expect(screen.getAllByRole('note', { name: /: zatím nepodporováno$/ })).toHaveLength(5)
  })
})
