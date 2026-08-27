import './styles.css';
import { getClientId, getApiKey, saveCredentials, clearCredentials, hasCredentials } from './config.js';
import { pickFolder, listXmlFiles, downloadFiles } from './drive.js';
import { parseInvoiceXml, detectIssues } from './xml.js';
import { buildAndDownload } from './excel.js';

const $ = (id) => document.getElementById(id);

const btnPick = $('btn-pick');
const btnDownload = $('btn-download');
const btnSettings = $('btn-settings');
const btnClear = $('btn-clear-settings');
const modal = $('modal-settings');
const formSettings = $('form-settings');
const inputClientId = $('input-client-id');
const inputApiKey = $('input-api-key');
const cardProgress = $('card-progress');
const cardResult = $('card-result');
const progressLabel = $('progress-label');
const progressCount = $('progress-count');
const progressFill = $('progress-fill');
const resultSummary = $('result-summary');
const resultLog = $('result-log');
const optRecursive = $('opt-recursive');
const optDetect = $('opt-detect-errors');

let lastResult = null;
let busy = false;

// ---------- Modal de configuración ----------
function openSettings() {
  inputClientId.value = getClientId();
  inputApiKey.value = getApiKey();
  modal.hidden = false;
}
function closeSettings() {
  modal.hidden = true;
}
btnSettings.addEventListener('click', openSettings);
modal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeSettings();
});
btnClear.addEventListener('click', () => {
  clearCredentials();
  inputClientId.value = '';
  inputApiKey.value = '';
});
formSettings.addEventListener('submit', (e) => {
  e.preventDefault();
  saveCredentials(inputClientId.value.trim(), inputApiKey.value.trim());
  closeSettings();
});

// ---------- Progreso ----------
function setProgress(visible, label, countText, pct) {
  cardProgress.hidden = !visible;
  if (!visible) return;
  progressLabel.textContent = label;
  progressCount.textContent = countText || '';
  progressFill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
}

// ---------- Flujo principal ----------
async function run() {
  if (busy) return;
  if (!hasCredentials()) {
    openSettings();
    alert('Primero escribe tu Client ID y API Key de Google en Configuración.');
    return;
  }
  busy = true;
  btnPick.disabled = true;
  cardResult.hidden = true;
  resultLog.hidden = true;

  const clientId = getClientId();
  const apiKey = getApiKey();
  let folder = null;

  try {
    // 1) Elegir carpeta
    folder = await pickFolder({ clientId, apiKey });
    if (!folder) return; // usuario canceló

    // 2) Listar XML
    setProgress(true, 'Buscando archivos XML en Drive…', '');
    const files = await listXmlFiles(folder.id, {
      recursive: optRecursive.checked,
      clientId,
      onProgress: (n) => {
        progressCount.textContent = `${n} archivo(s) encontrado(s)`;
      },
    });

    if (files.length === 0) {
      setProgress(false);
      alert('No se encontraron archivos XML en la carpeta seleccionada.');
      return;
    }

    // 3) Descargar y procesar
    const results = await downloadFiles(files, {
      clientId,
      onProgress: (done, total, name) => {
        setProgress(
          true,
          'Descargando y procesando facturas…',
          `${done} de ${total}`,
          Math.round((done / total) * 100),
        );
      },
    });

    // 4) Parsear
    const rawRows = [];
    const registro = [];
    const uuidMap = new Map();
    let okCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const r of results) {
      let parsed = null;
      let error = r.error || '';
      try {
        if (!error) parsed = parseInvoiceXml(r.text, r.name);
      } catch (err) {
        error = err.message;
      }

      if (parsed) {
        const warnings = detectIssues(parsed, { enabled: optDetect.checked });
        const regRow = {
          archivo: r.name,
          estado: warnings.length ? 'CON OBSERVACIONES' : 'OK',
          error: '',
          observaciones: warnings.join('; '),
          ...parsed.meta,
        };
        // Asignar fila del diccionario con nombre de archivo y observaciones
        const row = { Archivo: r.name, ...parsed.row };
        row['__warnings'] = warnings;
        row['__uuid'] = parsed.uuid;
        rawRows.push(row);
        registro.push(regRow);

        if (warnings.length) warningCount++;
        okCount++;

        if (parsed.uuid) {
          if (!uuidMap.has(parsed.uuid)) uuidMap.set(parsed.uuid, []);
          uuidMap.get(parsed.uuid).push(r.name);
        }
      } else {
        errorCount++;
        registro.push({
          archivo: r.name,
          estado: 'ERROR',
          error,
          observaciones: '',
          uuid: '',
          fecha: '',
          serie: '',
          folio: '',
          tipoDeComprobante: '',
          emisorRfc: '',
          emisorNombre: '',
          receptorRfc: '',
          receptorNombre: '',
          subtotal: '',
          total: '',
          moneda: '',
          version: '',
        });
      }
    }

    // 5) Duplicados de UUID
    const duplicateUuids = [];
    for (const [uuid, filesArr] of uuidMap.entries()) {
      if (filesArr.length > 1) duplicateUuids.push({ uuid, files: filesArr });
    }
    for (const reg of registro) {
      const dup = reg.uuid && duplicateUuids.some((d) => d.uuid === reg.uuid);
      reg.duplicado = dup ? 'SÍ' : '';
      if (dup) reg.observaciones = (reg.observaciones ? reg.observaciones + '; ' : '') + 'UUID duplicado';
    }

    // 6) Construir columnas ordenadas del diccionario (unión de campos)
    const columns = ['Archivo'];
    const seen = new Set();
    for (const row of rawRows) {
      for (const k of Object.keys(row)) {
        if (k === 'Archivo' || k === '__warnings' || k === '__uuid') continue;
        if (!seen.has(k)) {
          seen.add(k);
          columns.push(k);
        }
      }
    }
    columns.push('Observaciones');

    const facturas = rawRows.map((r) => {
      const out = { Archivo: r.Archivo };
      for (const c of columns) {
        if (c === 'Archivo') continue;
        if (c === 'Observaciones') {
          out[c] = r.__warnings.join('; ');
        } else {
          out[c] = r[c] == null ? '' : r[c];
        }
      }
      return out;
    });

    const summary = {
      folderName: folder.name,
      filesFound: files.length,
      okCount,
      errorCount,
      warningCount,
      duplicateUuids,
      generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    lastResult = { facturas, registro, summary };

    // 7) Mostrar resultado
    renderResult(summary, registro);

    setProgress(false);
  } catch (err) {
    setProgress(false);
    alert('Ocurrió un error: ' + (err && err.message ? err.message : err));
  } finally {
    busy = false;
    btnPick.disabled = false;
  }
}

function renderResult(summary, registro) {
  cardResult.hidden = false;

  const errores = registro.filter((r) => r.estado === 'ERROR');
  resultSummary.innerHTML = `
    <div class="stat"><span class="stat__num">${summary.filesFound}</span><span class="stat__lbl">XML encontrados</span></div>
    <div class="stat"><span class="stat__num">${summary.okCount}</span><span class="stat__lbl">Facturas procesadas</span></div>
    <div class="stat"><span class="stat__num">${summary.warningCount}</span><span class="stat__lbl">Con observaciones</span></div>
    <div class="stat"><span class="stat__num">${summary.errorCount}</span><span class="stat__lbl">Con error</span></div>
    <div class="stat"><span class="stat__num">${summary.duplicateUuids.length}</span><span class="stat__lbl">UUID duplicados</span></div>
  `;

  if (errores.length) {
    resultLog.hidden = false;
    resultLog.textContent = 'Archivos que NO se pudieron procesar:\n' +
      errores.map((r) => `• ${r.archivo} — ${r.error}`).join('\n');
  } else {
    resultLog.hidden = true;
  }
}

btnDownload.addEventListener('click', (e) => {
  e.preventDefault();
  if (!lastResult) return;
  try {
    buildAndDownload(lastResult);
  } catch (err) {
    alert('No se pudo generar el Excel: ' + (err && err.message ? err.message : err));
  }
});

btnPick.addEventListener('click', run);

// Ctrl/Cmd + Enter para abrir configuración
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});
