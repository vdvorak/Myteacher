/* @refresh reload */
import { render } from 'solid-js/web'
import { App } from './App'
import { httpApis } from './api/context'
import { I18nProvider } from './i18n/i18n'
import './styles/tokens.css'
import './styles/base.css'
import './preview/preview.css'

render(
  () => (
    <I18nProvider>
      <App apis={httpApis} />
    </I18nProvider>
  ),
  document.getElementById('root')!,
)
