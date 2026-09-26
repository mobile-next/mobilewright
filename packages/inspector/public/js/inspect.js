import { Inspector, applyTheme, makeResizable } from './app.js'

makeResizable(document.getElementById('screenshot-splitter'), document.getElementById('screenshot-pane'), '--screenshot-width', 1)
makeResizable(document.getElementById('detail-splitter'), document.getElementById('detail-pane'), '--detail-width', -1)

applyTheme(localStorage.getItem('mobilewright-inspector-theme') || 'void')
new Inspector()
