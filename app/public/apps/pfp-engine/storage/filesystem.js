(function () {
  'use strict';

  const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp)$/i;

  async function walkDirectory(handle, prefix, files) {
    for await (const [name, entry] of handle.entries()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') await walkDirectory(entry, relative, files);
      else if (IMAGE_EXT.test(name)) files.push({ handle: entry, relative });
    }
  }

  async function uploadDirectory(handle, asCollection) {
    const files = [];
    await walkDirectory(handle, handle.name || 'Layer', files);
    if (!files.length) throw new Error('No image files found in that folder.');
    const form = new FormData();
    for (const item of files) {
      const file = await item.handle.getFile();
      form.append(item.relative, file, file.name);
    }
    const params = new URLSearchParams({ folder: '' });
    if (asCollection) params.set('collection', '1');
    const response = await fetch(`/api/layers/upload?${params}`, { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Folder upload failed.');
    if (typeof refreshLayers === 'function') await refreshLayers();
    return result;
  }

  window.MiyaFilesystem = {
    async pickDirectory(asCollection) {
      if (!window.showDirectoryPicker) return false;
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        await uploadDirectory(handle, Boolean(asCollection));
        return true;
      } catch (error) {
        if (error.name === 'AbortError') return true;
        alert(`Could not read folder: ${error.message}`);
        return true;
      }
    },
    uploadDirectory,
  };
})();
