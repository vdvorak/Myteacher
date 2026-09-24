/* @refresh reload */
import { render } from 'solid-js/web'
import { App } from './App'
import { I18nProvider } from './i18n/i18n'
import './styles/tokens.css'
import './styles/base.css'
import './preview/preview.css'

render(
  () => (
    <I18nProvider>
      <App location={window.location} />
    </I18nProvider>
  ),
  document.getElementById('root')!,
)
