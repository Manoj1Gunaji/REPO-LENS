/**
 * StatCard Component Helper
 * Returns HTML markup for a CodeLens dashboard metric card
 */
function renderStatCard({ title, value, note, icon = 'folder-git-2', iconColor = 'purple-icon', noteClass = '' }) {
  return `
    <div class="stat-card">
      <div class="stat-top">
        <span>${title}</span>
        <i data-lucide="${icon}" class="${iconColor}"></i>
      </div>
      <h2>${value}</h2>
      <p class="${noteClass}">${note}</p>
    </div>
  `;
}

module.exports = { renderStatCard };