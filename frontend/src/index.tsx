/* @refresh reload */
import { render } from 'solid-js/web'
import { App } from './App'
import { httpAuthApi } from './auth/api'
import { I18nProvider } from './i18n/i18n'
import './styles/tokens.css'
import './styles/base.css'
import './preview/preview.css'

render(
  () => (
    <I18nProvider>
      <App auth={httpAuthApi} />
    </I18nProvider>
  ),
  document.getElementById('root')!,
)
