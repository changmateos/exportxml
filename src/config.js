// Resolución de credenciales de Google.
// Prioridad: lo escrito por el usuario en la app (localStorage) > variables de entorno del build.

const STORAGE_CLIENT_ID = 'exportxml_client_id';
const STORAGE_API_KEY = 'exportxml_api_key';

export function getClientId() {
  return localStorage.getItem(STORAGE_CLIENT_ID) || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

export function getApiKey() {
  return localStorage.getItem(STORAGE_API_KEY) || import.meta.env.VITE_GOOGLE_API_KEY || '';
}

export function saveCredentials(clientId, apiKey) {
  if (clientId) localStorage.setItem(STORAGE_CLIENT_ID, clientId);
  else localStorage.removeItem(STORAGE_CLIENT_ID);
  if (apiKey) localStorage.setItem(STORAGE_API_KEY, apiKey);
  else localStorage.removeItem(STORAGE_API_KEY);
}

export function clearCredentials() {
  localStorage.removeItem(STORAGE_CLIENT_ID);
  localStorage.removeItem(STORAGE_API_KEY);
}

export function hasCredentials() {
  return Boolean(getClientId() && getApiKey());
}
