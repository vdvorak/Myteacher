import { render, screen } from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { withI18n } from '../lesson/testing'
import type { Locale } from '../i18n/messages'
import { SmtpSettingsForm } from './SmtpSettingsForm'
import { fakeAdminApi, unconfigured } from './testing'

const configured = {
  ...unconfigured,
  configured: true,
  host: 'smtp.skola.example',
  username: 'myteacher',
  sender: 'myteacher@skola.example',
  password_set: true,
}

function renderForm(api = fakeAdminApi(), locale: Locale = 'en') {
  render(withI18n(() => <SmtpSettingsForm api={api} defaultRecipient="admin@skola.example" />, locale))
  return api
}

describe('SMTP settings form', () => {
  it('saves new settings with the password', async () => {
    const api = renderForm()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Server'), 'smtp.skola.example')
    await user.clear(screen.getByLabelText('Port'))
    await user.type(screen.getByLabelText('Port'), '465')
    await user.selectOptions(screen.getByLabelText('Security'), 'ssl')
    await user.type(screen.getByLabelText('Username'), 'myteacher')
    await user.type(screen.getByLabelText('Password'), 'smtp secret')
    await user.type(screen.getByLabelText('Sender address'), 'myteacher@skola.example')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.')
    expect(api.saveSmtp).toHaveBeenCalledWith({
      host: 'smtp.skola.example',
      port: 465,
      security: 'ssl',
      username: 'myteacher',
      password: 'smtp secret',
      sender: 'myteacher@skola.example',
    })
  })

  it('never shows the stored password and keeps it when left empty', async () => {
    const api = renderForm(fakeAdminApi(configured))
    const user = userEvent.setup()

    const password = await screen.findByLabelText('Password')
    expect(await screen.findByDisplayValue('smtp.skola.example')).toBeInTheDocument()
    expect(password).toHaveValue('')
    expect(screen.getByText('A password is saved. Leave empty to keep it.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(api.saveSmtp.mock.calls[0][0]).not.toHaveProperty('password')
  })

  it('can remove the stored password', async () => {
    const api = renderForm(fakeAdminApi(configured))
    const user = userEvent.setup()

    await user.click(await screen.findByLabelText('Remove the saved password'))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(api.saveSmtp.mock.calls[0][0]).toHaveProperty('password', '')
  })

  it('sends a test email in the interface language and reports success', async () => {
    const api = renderForm(fakeAdminApi(configured), 'cs')
    const user = userEvent.setup()

    expect(await screen.findByLabelText('Poslat zkušební e-mail na')).toHaveValue('admin@skola.example')
    await user.click(screen.getByRole('button', { name: 'Odeslat zkušební e-mail' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Zkušební e-mail odešel na admin@skola.example.')
    expect(api.sendTestEmail).toHaveBeenCalledWith('admin@skola.example', 'cs')
  })

  it('shows the SMTP error when the test email fails', async () => {
    renderForm(fakeAdminApi(configured, 'The SMTP server rejected the username or password.'))
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Send test email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The test email was not sent: The SMTP server rejected the username or password.',
    )
  })
})
