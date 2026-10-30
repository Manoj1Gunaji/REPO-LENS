/**
 * Sidebar Component Helper
 * Returns HTML markup for CodeLens AI navigation sidebar
 */
function renderSidebar(active = 'dashboard') {
  const links = [
    { href: '/dashboard', id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { href: '/upload', id: 'upload', icon: 'cloud-upload', label: 'Upload Repo' },
    { href: '/explorer', id: 'explorer', icon: 'file-code-2', label: 'Code Explorer' },
    { href: '/search', id: 'search', icon: 'sparkles', label: 'AI Code Search' },
    { href: '/evaluation', id: 'evaluation', icon: 'chart-column', label: 'Evaluation Suite' }
  ];

  return `
    <aside class="sidebar">
      <p class="sidebar-heading">WORKSPACE</p>
      ${links
        .map(
          (link) => `
        <a href="${link.href}" class="sidebar-link ${active === link.id ? 'selected' : ''}">
          <i data-lucide="${link.icon}"></i>
          <span>${link.label}</span>
        </a>
      `
        )
        .join('')}
    </aside>
  `;
}

module.exports = { renderSidebar };