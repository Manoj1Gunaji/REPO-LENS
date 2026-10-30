document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        lucide.createIcons();
    }

    const queryInput = document.getElementById('queryInput');
    const searchForm = document.getElementById('searchForm');

    window.setQuery = function(text) {
        if (queryInput) {
            queryInput.value = text;
            if (searchForm) searchForm.submit();
        }
    };

    window.copySnippet = function(elementId) {
        const el = document.getElementById(elementId);
        if (el) {
            navigator.clipboard.writeText(el.innerText).then(() => {
                alert('Code snippet copied to clipboard!');
            });
        }
    };
});