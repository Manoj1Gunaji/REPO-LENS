document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        lucide.createIcons();
    }

    const runBtn = document.getElementById('runBenchmarkBtn');
    if (runBtn) {
        runBtn.closest('form').addEventListener('submit', () => {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Running Benchmark (10 queries)...';
            if (window.lucide) lucide.createIcons();
        });
    }
});