const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv'
]);

const IGNORED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.mp4', '.mp3', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.lock', '.lockb', '-lock.json', '.sqlite', '.db', '.log',
  '.map', '.min.js', '.min.css', '.pyc', '.class'
]);

const EXTENSION_LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript (JSX)',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (TSX)',
  '.py': 'Python',
  '.java': 'Java',
  '.cpp': 'C++',
  '.c': 'C',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.json': 'JSON',
  '.html': 'HTML',
  '.css': 'CSS',
  '.md': 'Markdown'
};

const normalizePath = (filePath) => {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
};

const isSafeSubpath = (baseDir, targetPath) => {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
};

const ensureDir = async (dirPath) => {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
};

const extractZip = async (zipFilePath, destinationDir) => {
  await ensureDir(destinationDir);
  const zip = new AdmZip(zipFilePath);
  const zipEntries = zip.getEntries();
  const extractedFiles = [];

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;

    const entryName = normalizePath(entry.entryName);
    const targetPath = path.resolve(destinationDir, entryName);

    // ZIP Slip defense
    if (!isSafeSubpath(destinationDir, targetPath)) {
      console.warn(`[Security] Skipped ZIP slip path: ${entry.entryName}`);
      continue;
    }

    const entryDir = path.dirname(targetPath);
    await ensureDir(entryDir);

    try {
      const data = entry.getData();
      await fsPromises.writeFile(targetPath, data);
      extractedFiles.push({
        fullPath: targetPath,
        relativePath: normalizePath(path.relative(destinationDir, targetPath)),
        size: entry.header.size
      });
    } catch (err) {
      console.error(`Error extracting ${entry.entryName}: ${err.message}`);
    }
  }

  return extractedFiles;
};

const shouldIndexFile = (relativePath, fileSize = 0) => {
  const normalized = normalizePath(relativePath);
  const parts = normalized.split('/');

  for (const part of parts) {
    if (IGNORED_DIRECTORIES.has(part)) {
      return false;
    }
    if (part.startsWith('.') && part !== '.' && part !== '..') {
      if (part === '.env' || part.startsWith('.env.')) return false;
    }
  }

  const filename = parts[parts.length - 1];
  const ext = path.extname(filename).toLowerCase();

  if (IGNORED_EXTENSIONS.has(ext)) return false;
  if (filename === 'package-lock.json' || filename === 'yarn.lock') return false;
  if (fileSize > 1024 * 1024) return false; // 1MB limit

  return true;
};

const detectLanguage = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'dockerfile') return 'Dockerfile';
  if (basename === 'makefile') return 'Makefile';
  return EXTENSION_LANGUAGE_MAP[ext] || 'Text';
};

const scanDirectory = async (dir) => {
  const results = [];
  const walk = async (currentDir) => {
    let entries = [];
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = await fsPromises.stat(fullPath);
          const relativePath = normalizePath(path.relative(dir, fullPath));
          if (shouldIndexFile(relativePath, stat.size)) {
            results.push({
              fullPath,
              relativePath,
              size: stat.size,
              language: detectLanguage(relativePath)
            });
          }
        } catch {}
      }
    }
  };

  await walk(dir);
  return results;
};

const readFileContent = async (filePath) => {
  try {
    return await fsPromises.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
};

module.exports = {
  extractZip,
  scanDirectory,
  shouldIndexFile,
  detectLanguage,
  readFileContent,
  normalizePath,
  ensureDir
};