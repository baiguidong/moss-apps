export const CUA_VERSION = '0.34.0';
export const CUA_HOST_BUNDLE_ID = 'com.moss.ai';
export const CUA_ARTIFACTS = Object.freeze({
  'darwin-arm64': {
    filename: 'cua-driver-rs-0.34.0-darwin-arm64.tar.gz',
    directory: 'cua-driver-rs-0.34.0-darwin-arm64',
    sha256: '329bcc140c4840a5877e2cfc9f756351eb4a70c2c2d6acf4954751918122c60a',
    files: ['cua-driver', 'cua-cursor-theme', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  },
  'darwin-x64': {
    filename: 'cua-driver-rs-0.34.0-darwin-x86_64.tar.gz',
    directory: 'cua-driver-rs-0.34.0-darwin-x86_64',
    sha256: '9f362ad3af021c2d092c89172a02663e5c7d8788f8f7643a0b5f4eb568279b27',
    files: ['cua-driver', 'cua-cursor-theme', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  },
  'win32-x64': {
    filename: 'cua-driver-rs-0.34.0-windows-x86_64.zip',
    directory: 'cua-driver-rs-0.34.0-windows-x86_64',
    sha256: 'f96cc1632bc88e6f268eab745277c1fc302bb0f7d123e04373e35afecad6439f',
    files: ['cua-driver.exe', 'cua-driver-uia.exe', 'cua-cursor-theme.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
  },
});
export const CUA_TOOLS = Object.freeze([
  'list_apps', 'list_windows', 'launch_app', 'get_window_state',
  'click', 'type_text', 'press_key', 'hotkey', 'scroll', 'set_value',
  'start_session', 'end_session', 'check_permissions', 'health_report',
]);
