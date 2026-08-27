# ExportXML · Facturas CFDI de Google Drive a Excel

Aplicación web (minimalista, pensada para un despacho de contadores) que:

1. Deja que el usuario elija **una carpeta de Google Drive**.
2. Busca todos los archivos **XML** de esa carpeta (y subcarpetas, opcional).
3. Lee cada factura (CFDI 3.3 / 4.0) y **aplana todos sus campos**.
4. Genera **un solo archivo Excel** descargable con todo consolidado.

> 🔒 **Privacidad**: todo se procesa en el navegador del contador. Las facturas **no se suben a ningún servidor**. Solo se pide acceso de **solo lectura** a Drive.

---

## Qué contiene el Excel resultante

| Hoja | Contenido |
|------|-----------|
| **Facturas** | Diccionario de datos completo: **una fila por factura** y **cada campo del XML es una columna** (`Folio`, `Total`, `Emisor.Rfc`, `Concepto.ClaveProdServ`, `Complemento.TimbreFiscalDigital.UUID`, etc.). |
| **Registro** | Una fila por archivo con estado (`OK`, `CON OBSERVACIONES`, `ERROR`), UUID, RFCs, totales y las observaciones detectadas. |
| **Resumen** | Conteos generales, UUID duplicados y fecha de generación. |

Los elementos que se repiten (conceptos, traslados, retenciones, doctos relacionados…) se consolidan en **una sola columna** y sus valores se unen con ` | ` para no exceder el límite de columnas de Excel (16 384). Ej.: `Concepto.ClaveProdServ` = `01010101 | 01010102 | …`. Todo se guarda como texto para no perder ceros a la izquierda de folios o RFCs.

---

## Requisitos previos

- Una cuenta de **Google** (Gmail o Google Workspace).
- Una cuenta de **Vercel** (gratuita; puedes iniciar sesión con GitHub o Google).
- (Recomendado) Una cuenta de **GitHub** para el despliegue automático.

---

## PARTE 1 · Crear las credenciales en Google Cloud

### 1.1 Crear un proyecto

1. Entra a <https://console.cloud.google.com>.
2. Arriba, junto al logo de Google Cloud, haz clic en el selector de proyecto → **Nuevo proyecto**.
3. Ponle un nombre, por ejemplo `exportxml`, y pulsa **Crear**.
4. Espera a que termine y asegúrate de que quede **seleccionado**.

### 1.2 Habilitar las APIs

1. En el menú de la izquierda ve a **API y servicios** → **Biblioteca**.
2. Busca **Google Drive API** → entra y pulsa **Habilitar**.
3. Vuelve a **Biblioteca**, busca **Google Picker API** → **Habilitar**.

### 1.3 Configurar la pantalla de consentimiento OAuth

1. Ve a **API y servicios** → **Pantalla de consentimiento de OAuth**.
2. Elige **Externo** → **Crear**.
3. En **Información de la aplicación** completa **todos** los campos obligatorios:
   - **Nombre de la aplicación**: `ExportXML`.
   - **Correo de asistencia al usuario**: tu correo.
   - **Dominio autorizado**: el dominio donde corre la app. Si usas Vercel, escribe `vercel.app` (o tu dominio si usas uno propio). Déjalo sin `https://`.
4. Abajo, en **Información de contacto del desarrollador**, escribe tu correo en **Direcciones de correo electrónico**. ⚠️ Este campo es **obligatorio**: si queda vacío, Google bloquea el inicio de sesión con *"no cumple con la política OAuth 2.0"*.
5. Pulsa **Guardar y continuar** hasta terminar y volver al resumen.
6. Confirma que el **Estado de publicación** quede en **Pruebas** (Testing). **No** lo pongas en "Producción".
7. En la pestaña **Público de prueba**, pulsa **Agregar usuarios** y añade el correo de **cada contador** que vaya a usar la app (incluido el tuyo).
8. Espera **1–2 minutos** a que Google propague los cambios y vuelve a intentar.

### 1.4 Crear el OAuth Client ID

1. Ve a **API y servicios** → **Credenciales**.
2. Pulsa **+ Crear credenciales** → **ID de cliente de OAuth**.
3. Tipo de aplicación: **Aplicación web**.
4. Nombre: `ExportXML Web`.
5. En **Orígenes de JavaScript autorizados**, agrega **dos** orígenes (uno por línea):
   - `http://localhost:5173` (para probar en tu computadora)
   - `https://TU-APP.vercel.app` (la URL que te dé Vercel — la agregarás después; puedes dejarla pendiente y volver a editarla)
6. Pulsa **Crear**. Copia y guarda el **ID de cliente** (tiene forma `xxxxxxxx.apps.googleusercontent.com`).

### 1.5 Crear la API Key

1. En **Credenciales**, pulsa **+ Crear credenciales** → **Clave de API**.
2. Copia y guarda la **clave** (empieza con `AIza...`).
3. *(Recomendado)* Pulsa el nombre de la clave → en **Restricciones de aplicación** elige **Sitios web (HTTP referrers)** y agrega `http://localhost:5173/*` y `https://TU-APP.vercel.app/*`. En **Restricciones de API** marca solo **Google Picker API** y **Google Drive API**. Pulsa **Guardar**.

---

## PARTE 2 · Desplegar en Vercel

Hay tres formas. La **Opción A (GitHub)** es la recomendada.

### Opción A — Con GitHub (recomendada)

1. Crea un repositorio nuevo en GitHub (público o privado) llamado, por ejemplo, `exportxml`.
2. Sube el contenido de esta carpeta al repositorio. Desde una terminal dentro de la carpeta:

   ```bash
   git init
   git add .
   git commit -m "Primera version"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/exportxml.git
   git push -u origin main
   ```

   (Reemplaza `TU_USUARIO` por tu usuario de GitHub.)

3. Entra a <https://vercel.com> e inicia sesión con **GitHub**.
4. Pulsa **Add New…** → **Project**.
5. Vercel te pedirá conectar GitHub → autoriza y elige el repositorio `exportxml` → **Import**.
6. En la pantalla de configuración **no necesitas cambiar nada**:
   - **Framework Preset**: `Vite` (se detecta automáticamente).
   - **Build Command**: `npm run build` (automático).
   - **Output Directory**: `dist` (automático).
7. Pulsa **Deploy** y espera a que termine.
8. Vercel te dará una URL del tipo `https://exportxml-xxxx.vercel.app`. **Cópiala.**

### Opción B — Con la CLI de Vercel (sin GitHub)

1. Instala Node.js (si no lo tienes) desde <https://nodejs.org>.
2. Instala la CLI: `npm install -g vercel`.
3. Dentro de la carpeta del proyecto ejecuta `vercel` y sigue las instrucciones (inicia sesión, acepta los valores por defecto).
4. Te dará una URL de producción.

### Opción C — Arrastrar la carpeta (la más simple)

1. Entra a <https://vercel.com/new>.
2. Arrastra la carpeta **`dist`** (que se genera al correr `npm run build` en tu computadora) al área punteada.
3. Vercel la publica como sitio estático y te da una URL.

> ⚠️ En la Opción C, cada vez que cambies algo tendrás que volver a compilar y arrastrar `dist`. Para uso continuo es mejor la Opción A.

---

## PARTE 3 · Conectar la app con tus credenciales

Ya desplegada la app, hay dos maneras. Usa **solo una**:

### Forma recomendada: escribir las credenciales en la app

1. Abre tu app en el navegador.
2. Haz clic en **⚙ Configuración**.
3. Pega tu **Client ID** y tu **API Key**.
4. Pulsa **Guardar**. Quedan guardadas **solo en ese navegador**.

> Repite este paso una vez en la computadora de cada contador. No se comparten entre equipos.

### Forma alternativa: variables de entorno en Vercel

1. En Vercel → tu proyecto → **Settings** → **Environment Variables**.
2. Agrega:
   - `VITE_GOOGLE_CLIENT_ID` = tu Client ID.
   - `VITE_GOOGLE_API_KEY` = tu API Key.
3. Haz **Redeploy** (o vuelve a subir un cambio para que se recompile).

---

## PARTE 4 · Autorizar el dominio de Vercel en Google (¡importante!)

1. Vuelve a **Google Cloud Console** → **API y servicios** → **Credenciales**.
2. Haz clic en tu **ID de cliente de OAuth** (Aplicación web).
3. En **Orígenes de JavaScript autorizados** agrega la URL exacta de Vercel, por ejemplo:
   `https://exportxml-xxxx.vercel.app`
4. Guarda.
5. Si restringiste la **API Key** por HTTP referrers, agrega ahí también `https://exportxml-xxxx.vercel.app/*`.

---

## Cómo usar la app (día a día)

1. Abre la URL de Vercel.
2. Pulsa **▦ Elegir carpeta en Google Drive**.
3. La primera vez, Google pedirá **acceder con tu cuenta** y autorizar el acceso de **solo lectura** a Drive. Acepta.
4. En el selector, navega y elige la **carpeta** que contiene las facturas.
5. La app lista, descarga y procesa los XML (verás una barra de progreso).
6. En **Campos para el Excel**, marca/desmarca las columnas que quieras incluir (puedes buscar un campo y usar "Seleccionar todo" / "Ninguno").
7. Pulsa **⬇ Descargar Excel**.
8. Si hubo archivos que no se pudieron leer, usa **Descargar reporte de errores** para obtenerlos en un CSV aparte (sin alargar la pantalla).

**Opciones útiles:**
- **Incluir subcarpetas**: activa para leer también las subcarpetas (p. ej., una por mes).
- **Detectar errores comunes**: marca automáticamente RFC inválidos, UUID mal formados o duplicados, fechas/faltantes, etc.
- **Selección de campos**: el diccionario de campos se arma con la unión de todos los XML leídos; eliges cuáles columnas incluir en el Excel final.

---

## Solución de problemas

| Problema | Solución |
|----------|----------|
| `Error 400: origin_mismatch` | La URL **exacta** del navegador no está en **Credenciales → tu ID de cliente OAuth → Orígenes de JavaScript autorizados**. Copia la URL de la barra de direcciones **sin** la barra final ni rutas (ej. `https://exportxml-xxxx.vercel.app`), agrégala tal cual y guarda. Si pruebas una URL de *preview* de Vercel, agrégala también o usa la URL de producción. |
| `access_denied` o "Esta app está bloqueada" | Tu correo no está en **Público de prueba** del consentimiento OAuth (Paso 1.3). Agrégalo. |
| La ventana de Google se bloquea | Permite ventanas emergentes (pop-ups) para ese sitio. |
| No encuentra archivos | Verifica que la carpeta tenga archivos `.xml` (no "Documentos de Google"). Si están en una **Unidad compartida**, confirma que tu cuenta puede verla. Si los XML están en subcarpetas, activa "Incluir subcarpetas". Recarga con **Ctrl+F5** y revisa que el pie de página diga `v5` (si no, estás viendo una versión anterior). |
| Error de Google Drive 403 | Copia el texto completo del error (incluye un motivo entre corchetes, p. ej. `[userRateLimitExceeded]` o `[insufficientFilePermissions]`). Suele ser: (1) la cuenta no tiene permiso sobre la carpeta, (2) se excedió el límite de peticiones (se reintenta solo), o (3) el administrador de Google Workspace restringe la API de Drive. |
| Se corta con carpetas muy grandes | Vuelve a ejecutar; si expira la sesión, elige de nuevo la carpeta. |
| El Excel no baja | Revisa que el navegador no bloquee descargas. |

---

## Desarrollo local (opcional)

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>. Recuerda que en Google Cloud debes tener `http://localhost:5173` en los orígenes autorizados.
