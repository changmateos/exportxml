import './styles.css';
import { getClientId, getApiKey, saveCredentials, clearCredentials, hasCredentials } from './config.js';
import { pickFolder, listFiles, downloadFiles, isXmlFile } from './drive.js';
import { parseInvoiceXml, detectIssues } from './xml.js';
import { buildAndDownload, downloadErrorReport } from './excel.js';

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
const cardFields = $('card-fields');
const progressLabel = $('progress-label');
const progressCount = $('progress-count');
const progressFill = $('progress-fill');
const resultSummary = $('result-summary');
const resultErrors = $('result-errors');
const errorsCount = $('errors-count');
const btnErrors = $('btn-errors');
const fieldSearch = $('field-search');
const btnSelectAll = $('btn-select-all');
const btnSelectNone = $('btn-select-none');
const fieldsCount = $('fields-count');
const fieldList = $('field-list');
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

// ---------- Selector de campos ----------
function groupOf(field) {
  const dot = field.indexOf('.');
  return dot === -1 ? 'Factura' : field.slice(0, dot);
}

function updateFieldsCount() {
  const boxes = fieldList.querySelectorAll('input[type="checkbox"]');
  let n = 0;
  boxes.forEach((b) => { if (b.checked) n++; });
  fieldsCount.textContent = `${n} de ${boxes.length} campos`;
}

function renderFieldPicker(fields) {
  cardFields.hidden = false;
  fieldList.innerHTML = '';

  const groups = new Map();
  for (const f of fields) {
    const g = groupOf(f);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }

  for (const [g, list] of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'fields__group';

    const title = document.createElement('div');
    title.className = 'fields__group-title';
    title.textContent = `${g} · ${list.length}`;
    wrap.appendChild(title);

    for (const f of list) {
      const label = document.createElement('label');
      label.className = 'fields__item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = f;
      cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + f));
      wrap.appendChild(label);
    }

    fieldList.appendChild(wrap);
  }

  updateFieldsCount();
}

fieldSearch.addEventListener('input', () => {
  const q = fieldSearch.value.trim().toLowerCase();
  fieldList.querySelectorAll('.fields__group').forEach((group) => {
    let visible = 0;
    group.querySelectorAll('.fields__item').forEach((item) => {
      const f = (item.querySelector('input').value || '').toLowerCase();
      const show = !q || f.includes(q);
      item.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    group.style.display = visible ? '' : 'none';
  });
});

fieldList.addEventListener('change', updateFieldsCount);

btnSelectAll.addEventListener('click', () => {
  fieldList.querySelectorAll('input[type="checkbox"]').forEach((b) => { b.checked = true; });
  updateFieldsCount();
});
btnSelectNone.addEventListener('click', () => {
  fieldList.querySelectorAll('input[type="checkbox"]').forEach((b) => { b.checked = false; });
  updateFieldsCount();
});

function getSelectedFields() {
  const sel = [];
  fieldList.querySelectorAll('input[type="checkbox"]').forEach((b) => {
    if (b.checked) sel.push(b.value);
  });
  return sel;
}

function buildFacturas() {
  const sel = getSelectedFields();
  return lastResult.rawRows.map((r) => {
    const out = { Archivo: r.Archivo };
    for (const c of sel) {
      out[c] = c === 'Observaciones' ? (r.__warnings || []).join('; ') : (r[c] == null ? '' : r[c]);
    }
    return out;
  });
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
  cardFields.hidden = true;

  const clientId = getClientId();
  const apiKey = getApiKey();
  let folder = null;

  try {
    // 1) Elegir carpeta
    folder = await pickFolder({ clientId, apiKey });
    if (!folder) return; // usuario canceló

    // 2) Listar archivos
    setProgress(true, 'Buscando archivos en Drive…', '');
    const { files: allFiles, folders } = await listFiles(folder.id, {
      recursive: optRecursive.checked,
      clientId,
      onProgress: (n) => {
        progressCount.textContent = `${n} archivo(s) encontrado(s)`;
      },
    });

    // Candidatos por nombre/extensión (sin distinguir mayúsculas) o por MIME XML
    let files = allFiles.filter((f) => isXmlFile(f.name, f.mimeType));
    let fallbackMode = false;

    // Respaldo: si no hay candidatos por nombre, escanear el contenido de todos
    // los archivos para detectar los que realmente son XML (p. ej. sin extensión).
    if (files.length === 0 && allFiles.length > 0) {
      fallbackMode = true;
      files = allFiles;
      setProgress(true, 'No se detectaron archivos por nombre; escaneando contenido…', `${files.length} archivo(s)`);
    }

    if (files.length === 0) {
      setProgress(false);
      const hintSubcarpetas =
        folders.length > 0 && !optRecursive.checked
          ? '\n\n• La carpeta tiene subcarpetas: activa "Incluir subcarpetas" si los XML están dentro.'
          : '';
      alert(
        'La carpeta "' + folder.name + '" no devolvió ningún archivo.\n\n' +
          '• Verifica que la carpeta contenga facturas XML y que tu cuenta de Google pueda verla.' +
          hintSubcarpetas +
          '\n\nSi ya revisaste lo anterior, recarga la página con Ctrl+F5 y confirma que el pie de página dice "v7" (si no lo dice, aún estás viendo una versión anterior).'
      );
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
        // En modo respaldo (escaneo por contenido), los archivos que no son XML
        // se omiten sin contarse como error.
        if (fallbackMode && !r.error) continue;
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

    // 6) Diccionario de campos (unión de todos los XML)
    const fields = [];
    const seen = new Set();
    for (const row of rawRows) {
      for (const k of Object.keys(row)) {
        if (k === 'Archivo' || k === '__warnings' || k === '__uuid') continue;
        if (!seen.has(k)) {
          seen.add(k);
          fields.push(k);
        }
      }
    }
    fields.push('Observaciones');

    const summary = {
      folderName: folder.name,
      filesFound: okCount + errorCount,
      okCount,
      errorCount,
      warningCount,
      duplicateUuids,
      generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    const errores = registro.filter((r) => r.estado === 'ERROR');
    lastResult = { rawRows, fields, registro, summary, errores };

    // 7) Mostrar resultado y selector de campos
    renderResult(summary, errores);
    renderFieldPicker(fields);

    setProgress(false);
  } catch (err) {
    setProgress(false);
    alert('Ocurrió un error: ' + (err && err.message ? err.message : err));
  } finally {
    busy = false;
    btnPick.disabled = false;
  }
}

function renderResult(summary, errores) {
  cardResult.hidden = false;

  resultSummary.innerHTML = `
    <div class="stat"><span class="stat__num">${summary.filesFound}</span><span class="stat__lbl">XML encontrados</span></div>
    <div class="stat"><span class="stat__num">${summary.okCount}</span><span class="stat__lbl">Facturas procesadas</span></div>
    <div class="stat"><span class="stat__num">${summary.warningCount}</span><span class="stat__lbl">Con observaciones</span></div>
    <div class="stat"><span class="stat__num">${summary.errorCount}</span><span class="stat__lbl">Con error</span></div>
    <div class="stat"><span class="stat__num">${summary.duplicateUuids.length}</span><span class="stat__lbl">UUID duplicados</span></div>
  `;

  if (errores.length) {
    resultErrors.hidden = false;
    errorsCount.textContent = `${errores.length} archivo(s) no se pudieron procesar.`;
  } else {
    resultErrors.hidden = true;
  }
}

btnDownload.addEventListener('click', (e) => {
  e.preventDefault();
  if (!lastResult) return;
  try {
    const facturas = buildFacturas();
    buildAndDownload({ facturas, registro: lastResult.registro, summary: lastResult.summary });
  } catch (err) {
    alert('No se pudo generar el Excel: ' + (err && err.message ? err.message : err));
  }
});

btnErrors.addEventListener('click', () => {
  if (!lastResult || !lastResult.errores.length) return;
  downloadErrorReport(lastResult.errores);
});

btnPick.addEventListener('click', run);

// Ctrl/Cmd + Enter para abrir configuración
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});
