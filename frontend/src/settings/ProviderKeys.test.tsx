import { render, screen, within } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { withI18n } from '../lesson/testing'
import type { Credential } from './api'
import { ProviderKeys } from './ProviderKeys'
import { fakeSettingsApi } from './testing'

const KEY = 'sk-ant-api03-verysecretkey-7f3a'

const stored: Credential = {
  provider: 'anthropic',
  masked_key: '…7f3a',
  strong_model: 'claude-opus-5-5',
  fast_model: 'claude-haiku-4-5',
  updated_at: '2026-09-24T08:00:00Z',
}

function renderKeys(api = fakeSettingsApi()) {
  render(withI18n(() => <ProviderKeys api={api} accountId={1} />))
  return api
}

const card = async (label: string) => (await screen.findByRole('group', { name: label }))

describe('provider keys', () => {
  it('adds a key with the recommended model slots and shows only its masked tail', async () => {
    const api = renderKeys()
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByLabelText('Provider'), 'anthropic')
    expect(screen.getByLabelText('Strong model')).toHaveValue('claude-opus-5-5')
    expect(screen.getByLabelText('Fast model')).toHaveValue('claude-haiku-4-5')
    await user.type(screen.getByLabelText('API key'), KEY)
    await user.click(screen.getByRole('button', { name: 'Add key' }))

    const anthropic = await card('Anthropic')
    expect(within(anthropic).getByText('…7f3a')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(KEY)
    expect(screen.queryByDisplayValue(KEY)).toBeNull()
    expect(api.saveCredential).toHaveBeenCalledWith(1, 'anthropic', {
      api_key: KEY,
      strong_model: 'claude-opus-5-5',
      fast_model: 'claude-haiku-4-5',
    })
  })

  it('offers only providers that have no key yet', async () => {
    renderKeys(fakeSettingsApi({}, { credentials: [stored] }))

    const provider = await screen.findByLabelText('Provider')
    expect(within(provider).queryByRole('option', { name: 'Anthropic' })).toBeNull()
    expect(within(provider).getByRole('option', { name: 'OpenAI' })).toBeInTheDocument()
  })

  it('tests a stored key and reports that it works', async () => {
    const api = renderKeys(fakeSettingsApi({}, { credentials: [stored] }))
    const user = userEvent.setup()

    await user.click(within(await card('Anthropic')).getByRole('button', { name: 'Test key' }))

    expect(await within(await card('Anthropic')).findByRole('status')).toHaveTextContent('The key works.')
    expect(api.testCredential).toHaveBeenCalledWith(1, 'anthropic')
  })

  it.each([
    ['authentication', 'The provider rejected the key.'],
    ['quota', 'The key works, but its credit or rate limit is used up.'],
    ['other', 'The test call failed.'],
  ] as const)('explains a %s failure in plain words', async (kind, message) => {
    renderKeys(fakeSettingsApi({}, { credentials: [stored], keyProblem: kind }))
    const user = userEvent.setup()

    await user.click(within(await card('Anthropic')).getByRole('button', { name: 'Test key' }))

    expect(await within(await card('Anthropic')).findByRole('alert')).toHaveTextContent(message)
  })

  it('replaces a key without showing the old one', async () => {
    const api = renderKeys(fakeSettingsApi({}, { credentials: [stored] }))
    const user = userEvent.setup()
    const anthropic = await card('Anthropic')

    await user.type(within(anthropic).getByLabelText('New API key'), 'sk-ant-api03-another-91bc')
    await user.click(within(anthropic).getByRole('button', { name: 'Replace key' }))

    expect(await within(anthropic).findByText('…91bc')).toBeInTheDocument()
    expect(within(anthropic).getByRole('status')).toHaveTextContent('Saved.')
    expect(api.saveCredential).toHaveBeenCalledWith(1, 'anthropic', { api_key: 'sk-ant-api03-another-91bc' })
  })

  it('changes the model slots without resending the key', async () => {
    const api = renderKeys(fakeSettingsApi({}, { credentials: [stored] }))
    const user = userEvent.setup()
    const anthropic = await card('Anthropic')

    const strong = within(anthropic).getByLabelText('Strong model')
    await user.clear(strong)
    await user.type(strong, 'claude-sonnet-5')
    await user.click(within(anthropic).getByRole('button', { name: 'Save models' }))

    expect(await within(anthropic).findByRole('status')).toHaveTextContent('Saved.')
    expect(within(anthropic).getByLabelText('Strong model')).toHaveValue('claude-sonnet-5')
    expect(api.saveCredential).toHaveBeenCalledWith(1, 'anthropic', {
      strong_model: 'claude-sonnet-5',
      fast_model: 'claude-haiku-4-5',
    })
  })

  it('removes a key', async () => {
    const api = renderKeys(fakeSettingsApi({}, { credentials: [stored] }))
    const user = userEvent.setup()

    await user.click(within(await card('Anthropic')).getByRole('button', { name: 'Remove key' }))

    expect(api.removeCredential).toHaveBeenCalledWith(1, 'anthropic')
    expect(screen.queryByRole('group', { name: 'Anthropic' })).toBeNull()
  })
})
