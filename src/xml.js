// Parseo y aplanado de XML CFDI a un objeto "fila" (cada campo -> una columna).

const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/i;
const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const GENERIC_RFC = /^(XAXX010101000|XEXX010101000)$/i;

function setKey(row, key, value) {
  if (!key) return;
  const v = value == null ? '' : String(value).trim();
  if (key in row) {
    row[key] = row[key] + ' | ' + v;
  } else {
    row[key] = v;
  }
}

/**
 * Aplana recursivamente un elemento XML.
 * - Atributos del elemento raíz -> clave simple ("Folio", "Total").
 * - Atributos de elementos anidados -> "Padre.Hijo.Atributo".
 * - Elementos repetidos -> índice "[n]" (empieza en 1).
 * - Texto de un elemento hoja -> clave de su ruta.
 */
function flattenElement(el, prefix, row) {
  const children = Array.from(el.children);
  const hasElChildren = children.length > 0;

  // Atributos
  for (const attr of Array.from(el.attributes)) {
    const name = attr.localName || attr.name;
    const key = prefix ? `${prefix}.${name}` : name;
    setKey(row, key, attr.value);
  }

  // Texto directo (solo si es hoja con contenido)
  if (!hasElChildren) {
    const text = (el.textContent || '').trim();
    if (text && prefix) setKey(row, prefix, text);
  }

  // Agrupar hijos por nombre local para indexar los repetidos
  const groups = new Map();
  for (const c of children) {
    const n = c.localName || c.tagName;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(c);
  }

  for (const [name, list] of groups.entries()) {
    const multi = list.length > 1;
    list.forEach((c, i) => {
      const seg = multi ? `${name}[${i + 1}]` : name;
      const childPrefix = prefix ? `${prefix}.${seg}` : seg;
      flattenElement(c, childPrefix, row);
    });
  }
}

function firstByLocal(doc, localName) {
  for (const el of doc.getElementsByTagName('*')) {
    if ((el.localName || el.tagName) === localName) return el;
  }
  return null;
}

function attrOf(el, name) {
  if (!el) return '';
  const v = el.getAttribute(name);
  return v == null ? '' : String(v).trim();
}

function attrLocalOf(el, localName) {
  if (!el) return '';
  for (const attr of Array.from(el.attributes)) {
    if ((attr.localName || attr.name) === localName) return String(attr.value).trim();
  }
  return '';
}

function getUuid(doc) {
  const tfd = firstByLocal(doc, 'TimbreFiscalDigital');
  if (tfd) {
    const u = attrLocalOf(tfd, 'UUID');
    if (u) return u;
  }
  // Respaldo: cualquier atributo UUID del documento
  for (const el of doc.getElementsByTagName('*')) {
    const u = attrLocalOf(el, 'UUID');
    if (u) return u;
  }
  return '';
}

function validDate(value) {
  if (!value) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  return !Number.isNaN(Date.parse(value));
}

/**
 * Parsea un XML y devuelve { row, meta, warnings }.
 * - row: diccionario aplanado de campos.
 * - meta: datos clave para la hoja "Registro".
 * - warnings: lista de observaciones/errores detectados.
 */
function hasParserError(doc) {
  if (doc.querySelector('parsererror')) return true;
  if (doc.getElementsByTagNameNS('*', 'parsererror').length) return true;
  const root = doc.documentElement;
  return !!(root && ((root.localName || root.tagName) === 'parsererror'));
}

export function parseInvoiceXml(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (hasParserError(doc)) {
    throw new Error('XML inválido (no se pudo parsear)');
  }

  const root = doc.documentElement;
  if (!root) throw new Error('Documento XML vacío');

  const row = {};
  flattenElement(root, '', row);

  const emisor = firstByLocal(doc, 'Emisor');
  const receptor = firstByLocal(doc, 'Receptor');
  const emisorRfc = attrLocalOf(emisor, 'Rfc');
  const receptorRfc = attrLocalOf(receptor, 'Rfc');
  const uuid = getUuid(doc);

  const meta = {
    archivo: fileName,
    estado: 'OK',
    error: '',
    uuid,
    fecha: attrOf(root, 'Fecha'),
    serie: attrOf(root, 'Serie'),
    folio: attrOf(root, 'Folio'),
    tipoDeComprobante: attrOf(root, 'TipoDeComprobante'),
    emisorRfc,
    emisorNombre: attrLocalOf(emisor, 'Nombre'),
    receptorRfc,
    receptorNombre: attrLocalOf(receptor, 'Nombre'),
    subtotal: attrOf(root, 'SubTotal'),
    total: attrOf(root, 'Total'),
    moneda: attrOf(root, 'Moneda'),
    version: attrOf(root, 'Version'),
  };

  return { row, meta, uuid, emisorRfc, receptorRfc };
}

/**
 * Detecta errores comunes en una fila/meta ya parseada. Devuelve lista de textos.
 */
export function detectIssues({ meta, uuid, emisorRfc, receptorRfc }, { enabled }) {
  if (!enabled) return [];
  const w = [];
  if (!uuid) w.push('Sin UUID (timbre)');
  else if (!UUID_RE.test(uuid)) w.push('UUID con formato inválido');

  if (!emisorRfc) w.push('RFC emisor vacío');
  else if (!GENERIC_RFC.test(emisorRfc) && !RFC_RE.test(emisorRfc)) w.push('RFC emisor con formato inválido');

  if (!receptorRfc) w.push('RFC receptor vacío');
  else if (!GENERIC_RFC.test(receptorRfc) && !RFC_RE.test(receptorRfc)) w.push('RFC receptor con formato inválido');

  if (!meta.folio && !meta.serie) w.push('Sin Serie ni Folio');
  if (!validDate(meta.fecha)) w.push('Fecha ausente o inválida');
  if (meta.total === '') w.push('Sin Total');
  if (meta.subtotal === '') w.push('Sin SubTotal');
  return w;
}
