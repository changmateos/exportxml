// Generación del libro de Excel con SheetJS.

import * as XLSX from 'xlsx';

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '1F4E78' } },
  alignment: { vertical: 'center', horizontal: 'left' },
};

function buildSheet(rows, title) {
  const ws = XLSX.utils.json_to_sheet(rows, { defval: '' });
  const headers = rows.length ? Object.keys(rows[0]) : [];

  // Ancho de columnas según el contenido (limitado)
  const maxLen = {};
  for (const h of headers) maxLen[h] = Math.max(12, h.length);
  for (const r of rows) {
    for (const h of headers) {
      const v = r[h] == null ? '' : String(r[h]);
      if (v.length > maxLen[h]) maxLen[h] = Math.min(v.length, 60);
    }
  }
  ws['!cols'] = headers.map((h) => ({ wch: maxLen[h] + 1 }));

  // Encabezados con estilo
  if (headers.length) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = HEADER_STYLE;
    }
    ws['!autofilter'] = { ref: ws['!ref'] };
  }

  return ws;
}

function sheetOfRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (rows.length) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[addr]) ws[addr].s = HEADER_STYLE;
    }
  }
  ws['!cols'] = [{ wch: 32 }, { wch: 60 }];
  return ws;
}

/**
 * Construye y descarga el archivo .xlsx.
 * @param {Array<object>} facturas  filas del diccionario de datos (una por factura)
 * @param {Array<object>} registro  registro por archivo procesado
 * @param {object} summary           resumen de la corrida
 */
export function buildAndDownload({ facturas, registro, summary }) {
  const wb = XLSX.utils.book_new();

  const wsFacturas = buildSheet(facturas, 'Facturas');
  XLSX.utils.book_append_sheet(wb, wsFacturas, 'Facturas');

  const wsRegistro = buildSheet(registro, 'Registro');
  XLSX.utils.book_append_sheet(wb, wsRegistro, 'Registro');

  const resumenRows = [
    ['Resumen de la consolidación', ''],
    ['Carpeta', summary.folderName || ''],
    ['Archivos XML encontrados', summary.filesFound],
    ['Facturas procesadas correctamente', summary.okCount],
    ['Archivos con error', summary.errorCount],
    ['Facturas con observaciones', summary.warningCount],
    ['UUID duplicados', summary.duplicateUuids.length],
    ['Fecha de generación', summary.generatedAt],
    ['', ''],
    ['UUID', 'Archivos'],
  ];
  for (const dup of summary.duplicateUuids) {
    resumenRows.push([dup.uuid, dup.files.join('; ')]);
  }

  const wsResumen = sheetOfRows(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const stamp = summary.generatedAt.replace(/[^0-9A-Za-z]/g, '-');
  XLSX.writeFile(wb, `Facturas_${stamp}.xlsx`, { compression: true });
}
