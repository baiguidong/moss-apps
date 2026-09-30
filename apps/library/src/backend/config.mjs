export const SUPPORTED_LIBRARY_EXTENSIONS = Object.freeze([
  '.c', '.cc', '.cpp', '.css', '.csv', '.docx', '.go', '.h', '.hpp', '.htm',
  '.html', '.ini', '.java', '.js', '.json', '.jsx', '.log', '.markdown', '.md',
  '.mjs', '.pdf', '.pptx', '.py', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx',
  '.txt', '.xlsx', '.xml', '.yaml', '.yml',
]);

export const DEFAULT_LIBRARY_DIRECTORY_SCAN = Object.freeze({
  maxDepth: 3,
  maxFiles: 2_000,
  maxFileBytes: 50 * 1024 * 1024,
  extensions: SUPPORTED_LIBRARY_EXTENSIONS,
});
