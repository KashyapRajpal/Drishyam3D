/**
 * Helper utilities for opening and saving local files via standard web APIs.
 * Supports File System Access API (showOpenFilePicker / showSaveFilePicker) with input/blob fallback.
 */

export async function openTextFile() {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'JavaScript & Shader Files (*.js, *.wgsl, *.vert, *.frag, *.glsl)',
            accept: {
              'text/javascript': ['.js', '.mjs'],
              'application/javascript': ['.js', '.mjs'],
              'text/plain': ['.wgsl', '.glsl', '.vert', '.frag', '.txt', '.effect', '.js'],
            },
          },
        ],
        multiple: false,
      })
      const file = await handle.getFile()
      const text = await file.text()
      return { name: file.name, text, handle }
    } catch (err) {
      if (err.name === 'AbortError') return null
      console.warn('showOpenFilePicker failed, falling back to input element picker:', err)
    }
  }

  // Fallback for browsers without File System Access API or on picker failure
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.wgsl,.glsl,.vert,.frag,.effect,.txt,.js,.mjs,text/javascript,text/plain'
    let resolved = false

    const handleFocus = () => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          window.removeEventListener('focus', handleFocus)
          resolve(null)
        }
      }, 500)
    }

    input.onchange = async () => {
      resolved = true
      window.removeEventListener('focus', handleFocus)
      if (!input.files || input.files.length === 0) {
        resolve(null)
        return
      }
      const file = input.files[0]
      try {
        const text = await file.text()
        resolve({ name: file.name, text, handle: null })
      } catch (e) {
        reject(e)
      }
    }

    window.addEventListener('focus', handleFocus, { once: true })
    input.click()
  })
}

export async function saveTextFile(handle, text, defaultName = 'shader.wgsl') {
  if (handle && 'createWritable' in handle) {
    try {
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return handle
    } catch (err) {
      console.warn('Silent save failed, attempting Save As picker fallback', err)
    }
  }
  return saveTextFileAs(text, defaultName)
}

export async function saveTextFileAs(text, suggestedName = 'shader.wgsl') {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Shader / Script File',
            accept: {
              'text/javascript': ['.js', '.mjs'],
              'application/javascript': ['.js'],
              'text/plain': ['.wgsl', '.glsl', '.vert', '.frag', '.txt', '.effect', '.js'],
            },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      return handle
    } catch (err) {
      if (err.name === 'AbortError') return null
      throw err
    }
  }

  // Fallback blob download
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
  return null
}
