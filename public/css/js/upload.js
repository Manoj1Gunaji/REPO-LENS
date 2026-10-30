document.addEventListener('DOMContentLoaded', () => {
    const zipTab = document.getElementById('zipTab');
    const localTab = document.getElementById('localTab');
    const zipSection = document.getElementById('zipSection');
    const localSection = document.getElementById('localSection');
    const zipFile = document.getElementById('zipFile');
    const dropZone = document.getElementById('dropZone');
    const selectedFile = document.getElementById('selectedFile');
    const dropTitle = document.getElementById('dropTitle');

    if (zipTab && localTab && zipSection && localSection) {
        zipTab.addEventListener('click', () => {
            zipTab.classList.add('active');
            localTab.classList.remove('active');
            zipSection.classList.remove('hidden');
            localSection.classList.add('hidden');
        });

        localTab.addEventListener('click', () => {
            localTab.classList.add('active');
            zipTab.classList.remove('active');
            localSection.classList.remove('hidden');
            zipSection.classList.add('hidden');
        });
    }

    function showSelectedFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.zip')) {
            alert('Please select a valid .ZIP archive file.');
            if (zipFile) zipFile.value = '';
            if (selectedFile) selectedFile.textContent = '';
            if (dropTitle) dropTitle.textContent = 'Choose a ZIP archive or drag & drop here';
            return;
        }

        if (file.size > 500 * 1024 * 1024) {
            alert('Maximum archive size is 500MB.');
            if (zipFile) zipFile.value = '';
            if (selectedFile) selectedFile.textContent = '';
            return;
        }

        if (dropTitle) dropTitle.textContent = 'ZIP Archive Selected';
        if (selectedFile) {
            selectedFile.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
        }
    }

    if (zipFile) {
        zipFile.addEventListener('change', () => {
            if (zipFile.files && zipFile.files[0]) {
                showSelectedFile(zipFile.files[0]);
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-active');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-active');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-active');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                try {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    if (zipFile) {
                        zipFile.files = dt.files;
                        showSelectedFile(file);
                    }
                } catch (err) {
                    console.error('File drop transfer error:', err);
                }
            }
        });
    }

    if (window.lucide) lucide.createIcons();
});