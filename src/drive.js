// Conexión con Google Drive: autenticación, selector de carpeta, listado y descarga.

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

let currentToken = null;
let lastClientId = '';

function gapiLoad(name) {
  return new Promise((resolve, reject) => {
    if (!window.gapi || !window.gapi.load) {
      reject(new Error('No se pudo cargar el SDK de Google (gapi). Revisa tu conexión.'));
      return;
    }
    window.gapi.load(name, { callback: resolve, onerror: () => reject(new Error(`No se pudo cargar ${name}`)) });
  });
}

function requestAccessToken(clientId) {
  lastClientId = clientId;
  return new Promise((resolve, reject) => {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      reject(new Error('No se pudo cargar Google Identity Services.'));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: '',
      callback: (resp) => {
        if (resp && resp.error) reject(new Error(`Autorización denegada: ${resp.error}`));
        else resolve(resp);
      },
      error_callback: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
    client.requestAccessToken();
  });
}

/**
 * Abre el selector de carpeta de Google y devuelve { id, name } de la carpeta elegida.
 */
export async function pickFolder({ clientId, apiKey }) {
  await gapiLoad('picker');

  const resp = await requestAccessToken(clientId);
  currentToken = resp.access_token;

  const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true);

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(currentToken)
    .setDeveloperKey(apiKey)
    .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
    .build();

  return new Promise((resolve, reject) => {
    let settled = false;
    picker.setCallback((data) => {
      const action = data[window.google.picker.Response.ACTION];
      if (action === window.google.picker.Action.PICKED) {
        const doc = data[window.google.picker.Response.DOCUMENTS][0];
        settled = true;
        resolve({ id: doc[window.google.picker.Document.ID], name: doc[window.google.picker.Document.NAME] });
      } else if (action === window.google.picker.Action.CANCEL) {
        settled = true;
        resolve(null);
      }
    });
    picker.setVisible(true);
    // Respaldo: si el callback no dispara por algún motivo, no dejar la promesa colgada.
    setTimeout(() => {
      if (!settled) reject(new Error('El selector se cerró sin resultado.'));
    }, 5 * 60 * 1000);
  });
}

async function driveFetch(url, token, retried = false) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && !retried) {
    // Token vencido: solicitar uno nuevo (silencioso si ya se autorizó antes).
    if (!lastClientId) throw new Error('La sesión expiró; vuelve a elegir la carpeta.');
    const resp = await requestAccessToken(lastClientId);
    if (!resp.access_token) throw new Error('La sesión expiró; vuelve a elegir la carpeta.');
    currentToken = resp.access_token;
    return driveFetch(url, currentToken, true);
  }
  if (!res.ok) {
    throw new Error(`Error de Google Drive (${res.status}): ${res.statusText}`);
  }
  return res;
}

function isXmlFile(name, mimeType) {
  const lower = (name || '').toLowerCase();
  return lower.endsWith('.xml') || (mimeType || '').toLowerCase().includes('xml');
}

/**
 * Lista todos los archivos XML de una carpeta (y subcarpetas si recursive=true).
 */
export async function listXmlFiles(folderId, { recursive, clientId, onProgress }) {
  if (!currentToken) {
    const resp = await requestAccessToken(clientId);
    currentToken = resp.access_token;
  }

  const files = [];
  const queue = [folderId];
  const seenDirs = new Set([folderId]);

  while (queue.length) {
    const dirId = queue.shift();
    let pageToken = null;

    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', `'${dirId}' in parents and trashed = false`);
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const data = await driveFetch(url, currentToken);
      for (const f of data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (recursive && !seenDirs.has(f.id)) {
            seenDirs.add(f.id);
            queue.push(f.id);
          }
        } else if (isXmlFile(f.name, f.mimeType)) {
          files.push({ id: f.id, name: f.name });
        }
      }
      pageToken = data.nextPageToken || null;
      if (onProgress) onProgress(files.length);
    } while (pageToken);
  }

  return files;
}

/**
 * Descarga el contenido de los archivos con concurrencia limitada.
 * Devuelve un arreglo (mismo orden) de { id, name, text, error }.
 */
export async function downloadFiles(files, { clientId, onProgress }) {
  const results = new Array(files.length);
  let next = 0;
  const CONCURRENCY = 6;

  async function decode(res) {
    const buf = await res.arrayBuffer();
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 400));
    const m = /encoding\s*=\s*["']([^"']+)["']/i.exec(head);
    let enc = 'utf-8';
    if (m) {
      const e = m[1].toLowerCase().replace('_', '-').trim();
      if (e === 'iso-8859-1' || e === 'latin1' || e === 'windows-1252') enc = 'windows-1252';
      else if (e === 'utf-16' || e === 'utf-16le' || e === 'utf-16-le') enc = 'utf-16le';
      else if (e === 'utf-16be') enc = 'utf-16be';
      else enc = 'utf-8';
    }
    return new TextDecoder(enc).decode(buf);
  }

  async function worker() {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      try {
        const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`);
        url.searchParams.set('alt', 'media');
        const res = await driveFetch(url, currentToken);
        const text = await decode(res);
        results[i] = { id: f.id, name: f.name, text, error: null };
      } catch (err) {
        results[i] = { id: f.id, name: f.name, text: '', error: err.message };
      }
      if (onProgress) onProgress(next, files.length, f.name);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker);
  await Promise.all(workers);
  return results;
}
