// Browser-safe resource identity parsing shared by the renderer and Library service.
export const LIBRARY_RESOURCE_SCHEME = 'moss-knowledge:';

export function parseLibraryResourceUri(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw.startsWith('moss-knowledge://')) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid Library resource reference.');
  }
  const resourceId = url.pathname.replace(/^\/+/, '');
  if (url.protocol !== LIBRARY_RESOURCE_SCHEME || url.hostname !== 'resource'
    || !/^[a-zA-Z0-9-]{8,80}$/.test(resourceId)) {
    throw new Error('Invalid Library resource reference.');
  }
  return {
    resourceId,
    revision: url.searchParams.get('revision')?.trim() || null,
    name: url.searchParams.get('name')?.trim() || null,
    uri: raw,
  };
}
