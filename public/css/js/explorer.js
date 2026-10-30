document.addEventListener('DOMContentLoaded', async () => {
    const fileTreeContainer = document.getElementById('fileTree');
    const fileSearchInput = document.getElementById('fileSearch');
    const fileCountSpan = document.getElementById('fileCount');
    const selectedFileNameSpan = document.getElementById('selectedFileName');
    const languageBadge = document.getElementById('languageBadge');
    const copyButton = document.getElementById('copyButton');
    const codeContentContainer = document.getElementById('codeContent');
    const fileSizeSpan = document.getElementById('fileSize');
    const overviewLanguage = document.getElementById('overviewLanguage');
    const overviewLines = document.getElementById('overviewLines');
    const overviewSymbols = document.getElementById('overviewSymbols');
    const symbolListContainer = document.getElementById('symbolList');
    const filterButtons = document.querySelectorAll('.filter-button');

    let allFiles = [];
    let currentFile = null;
    let currentSymbols = [];
    let activeFilter = 'All';

    // Parse URL params for deep linking (e.g., from search results)
    const urlParams = new URLSearchParams(window.location.search);
    const initialFile = urlParams.get('file');
    const initialLine = parseInt(urlParams.get('line'), 10);

    // Fetch repository file tree
    async function loadTree() {
        try {
            const res = await fetch('/explorer/tree');
            if (!res.ok) throw new Error('Failed to load file tree');
            const data = await res.json();
            allFiles = data.files || [];
            if (fileCountSpan) fileCountSpan.textContent = `${allFiles.length} files`;
            renderTree(allFiles);

            if (allFiles.length > 0) {
                // If initialFile is specified in URL, load it; else load first file
                const targetFile = initialFile
                    ? allFiles.find(f => f.path === initialFile || f.path.endsWith(initialFile)) || allFiles[0]
                    : allFiles[0];
                loadFile(targetFile.path, initialLine);
            }
        } catch (err) {
            console.error('Error loading tree:', err);
            if (fileTreeContainer) {
                fileTreeContainer.innerHTML = '<div style="padding: 15px; color: #94a3b8; font-size: 12px;">Failed to load files. Please upload a repository first.</div>';
            }
        }
    }

    // Render tree list
    function renderTree(files) {
        if (!fileTreeContainer) return;
        fileTreeContainer.innerHTML = '';

        if (files.length === 0) {
            fileTreeContainer.innerHTML = '<div style="padding: 15px; color: #64748b; font-size: 12px;">No matching files</div>';
            return;
        }

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'tree-item' + (currentFile && currentFile.path === file.path ? ' active' : '');
            item.style.padding = '8px 12px';
            item.style.cursor = 'pointer';
            item.style.fontSize = '12px';
            item.style.borderRadius = '6px';
            item.style.marginBottom = '2px';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '8px';
            item.style.color = currentFile && currentFile.path === file.path ? '#ffffff' : '#94a3b8';
            item.style.background = currentFile && currentFile.path === file.path ? '#1b233a' : 'transparent';

            // Determine icon
            const isCode = !file.path.endsWith('.json') && !file.path.endsWith('.md');
            const iconName = isCode ? 'file-code' : 'file-text';
            
            item.innerHTML = `
                <i data-lucide="${iconName}" style="width: 14px; height: 14px; color: #818cf8; flex-shrink: 0;"></i>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.path}</span>
            `;

            item.addEventListener('click', () => {
                loadFile(file.path);
            });

            fileTreeContainer.appendChild(item);
        });

        if (window.lucide) lucide.createIcons();
    }

    // Load file content and symbols
    async function loadFile(filePath, jumpToLine = null) {
        try {
            const res = await fetch(`/explorer/file?filePath=${encodeURIComponent(filePath)}`);
            if (!res.ok) throw new Error('Failed to load file');
            const data = await res.json();

            currentFile = data;
            currentSymbols = data.symbols || [];

            // Update header info
            if (selectedFileNameSpan) selectedFileNameSpan.textContent = data.filePath;
            if (languageBadge) languageBadge.textContent = data.language || 'Plain Text';
            if (fileSizeSpan) fileSizeSpan.textContent = `${(data.content.length / 1024).toFixed(1)} KB`;
            if (overviewLanguage) overviewLanguage.textContent = data.language || '-';
            if (overviewLines) overviewLines.textContent = data.totalLines || (data.content.split('\n').length);
            if (overviewSymbols) overviewSymbols.textContent = currentSymbols.length;

            renderCode(data.content, data.language, jumpToLine);
            renderSymbols(currentSymbols);
            renderTree(allFiles); // Update active item highlight
        } catch (err) {
            console.error('Error loading file:', err);
        }
    }

    // Render code with exact 1-indexed line numbers
    function renderCode(content, language, highlightLine = null) {
        if (!codeContentContainer) return;
        const lines = content.split(/\r?\n/);
        
        let html = '<div class="code-viewer-table" style="display: flex; font-family: \'JetBrains Mono\', Consolas, monospace; font-size: 13px; line-height: 1.6; min-width: 100%;">';
        
        // Line numbers column
        html += '<div class="line-numbers" style="user-select: none; text-align: right; padding: 16px 12px 16px 8px; color: #475569; background: #080b15; border-right: 1px solid #1e293b; min-width: 45px;">';
        for (let i = 1; i <= lines.length; i++) {
            const isTarget = highlightLine === i;
            html += `<div id="L${i}" style="${isTarget ? 'color: #34d399; font-weight: bold;' : ''}">${i}</div>`;
        }
        html += '</div>';

        // Code column
        html += '<div class="code-lines" style="flex: 1; padding: 16px; overflow-x: auto; background: #0a0e1c;">';
        html += `<pre style="margin: 0; padding: 0;"><code class="language-${(language || 'javascript').toLowerCase()}">`;
        
        // Escape HTML
        const escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
            
        html += escapedContent;
        html += '</code></pre></div></div>';

        codeContentContainer.innerHTML = html;

        // Syntax highlighting
        const codeBlock = codeContentContainer.querySelector('pre code');
        if (codeBlock && window.hljs) {
            hljs.highlightElement(codeBlock);
        }

        // Jump to line if specified
        if (highlightLine) {
            setTimeout(() => {
                const targetLineEl = document.getElementById(`L${highlightLine}`);
                if (targetLineEl) {
                    targetLineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetLineEl.style.backgroundColor = 'rgba(139, 92, 246, 0.3)';
                    targetLineEl.style.padding = '0 4px';
                    targetLineEl.style.borderRadius = '4px';
                }
            }, 100);
        }
    }

    // Render symbols list in right panel
    function renderSymbols(symbols) {
        if (!symbolListContainer) return;
        symbolListContainer.innerHTML = '';

        const filtered = activeFilter === 'All'
            ? symbols
            : symbols.filter(s => s.type.toLowerCase() === activeFilter.toLowerCase());

        if (filtered.length === 0) {
            symbolListContainer.innerHTML = `<div class="no-symbols" style="padding: 15px; color: #64748b; font-size: 11px; text-align: center;">No ${activeFilter === 'All' ? '' : activeFilter} symbols in this file</div>`;
            return;
        }

        filtered.forEach(sym => {
            const item = document.createElement('div');
            item.className = 'symbol-item';
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span class="symbol-type">${sym.type}</span>
                    <span class="symbol-line" style="font-size: 10px; color: #818cf8;">L${sym.startLine}–L${sym.endLine}</span>
                </div>
                <h4 style="margin: 0; color: #f1f5f9; font-size: 12px; font-family: monospace;">${sym.name}</h4>
                ${sym.docstring ? `<p style="margin: 4px 0 0; color: #64748b; font-size: 10px; font-style: italic;">${sym.docstring.replace(/[\/*#]/g, '').slice(0, 60)}...</p>` : ''}
            `;

            // Clicking symbol jumps to exact line
            item.addEventListener('click', () => {
                const targetLineEl = document.getElementById(`L${sym.startLine}`);
                if (targetLineEl) {
                    targetLineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetLineEl.style.backgroundColor = 'rgba(139, 92, 246, 0.4)';
                    targetLineEl.style.padding = '0 4px';
                    targetLineEl.style.borderRadius = '4px';
                    setTimeout(() => {
                        targetLineEl.style.backgroundColor = 'transparent';
                    }, 2500);
                }
            });

            symbolListContainer.appendChild(item);
        });
    }

    // Filter buttons click
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter || 'All';
            renderSymbols(currentSymbols);
        });
    });

    // File search input
    if (fileSearchInput) {
        fileSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = allFiles.filter(f => f.path.toLowerCase().includes(query));
            renderTree(filtered);
        });
    }

    // Copy file code button
    if (copyButton) {
        copyButton.addEventListener('click', () => {
            if (currentFile && currentFile.content) {
                navigator.clipboard.writeText(currentFile.content).then(() => {
                    const origHtml = copyButton.innerHTML;
                    copyButton.innerHTML = '<i data-lucide="check"></i> Copied!';
                    if (window.lucide) lucide.createIcons();
                    setTimeout(() => {
                        copyButton.innerHTML = origHtml;
                        if (window.lucide) lucide.createIcons();
                    }, 2000);
                });
            }
        });
    }

    // Initial load
    loadTree();
});