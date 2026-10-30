/**
 * Layout Component Helper
 * Provides layout utility wrapper
 */
function renderLayout({ title = 'CodeLens AI', currentRepo = 'TaskMaster API', active = 'dashboard', content = '' }) {
  return `
    <div class="app-layout">
      <!-- Layout shell -->
      ${content}
    </div>
  `;
}

module.exports = { renderLayout };