const CodeChunk = require('../models/codechunk');
const Repository = require('../models/repository');
const { detectLanguage, readFileContent } = require('./fileScanner');

// Tokenizer supporting camelCase, PascalCase, snake_case, and kebab-case
function tokenize(text) {
  if (!text) return [];
  const words = text.match(/[A-Za-z0-9_]+/g) || [];
  const tokens = new Set();

  for (const word of words) {
    tokens.add(word.toLowerCase());
    // Split camelCase & PascalCase
    const splitCamel = word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
    if (splitCamel.length > 1) {
      for (const piece of splitCamel) {
        if (piece.length > 1) tokens.add(piece.toLowerCase());
      }
    }
    // Split snake_case
    const splitSnake = word.split('_');
    if (splitSnake.length > 1) {
      for (const piece of splitSnake) {
        if (piece.length > 1) tokens.add(piece.toLowerCase());
      }
    }
  }

  return Array.from(tokens).filter((t) => t.length > 1);
}

// Deterministic 128-dimensional unit vector embedding for semantic search
function generateEmbedding(text) {
  const DIMENSIONS = 128;
  const embedding = new Array(DIMENSIONS).fill(0);
  if (!text) return embedding;

  const tokens = tokenize(text);
  if (tokens.length === 0) return embedding;

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % DIMENSIONS;
    const sign = hash >= 0 ? 1 : -1;
    embedding[idx] += sign * (1 + Math.log(1 + token.length));
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIMENSIONS; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < DIMENSIONS; i++) {
      embedding[i] = Number((embedding[i] / norm).toFixed(6));
    }
  }

  return embedding;
}

// Find closing brace for block-scoped code
function findClosingBraceLine(lines, startIndex) {
  let openBraces = 0;
  let foundFirst = false;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    // Strip strings and comments roughly to avoid false brace counts
    const cleanLine = line.replace(/(["'`]).*?\1/g, '').replace(/\/\/.*$/, '');

    for (let char of cleanLine) {
      if (char === '{') {
        openBraces++;
        foundFirst = true;
      } else if (char === '}') {
        openBraces--;
        if (foundFirst && openBraces <= 0) {
          return i + 1; // 1-indexed
        }
      }
    }
  }
  return Math.min(lines.length, startIndex + 30);
}

// Find Python block end based on indentation
function findPythonBlockEnd(lines, startIndex, baseIndent) {
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const currentIndent = line.search(/\S/);
    if (currentIndent !== -1 && currentIndent <= baseIndent) {
      return i; // previous line was end
    }
  }
  return lines.length;
}

// Extract preceding docstring or comment block
function extractDocstring(lines, lineIndex) {
  let commentLines = [];
  let idx = lineIndex - 1;
  while (idx >= 0) {
    const trimmed = lines[idx].trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    ) {
      commentLines.unshift(trimmed);
      idx--;
    } else {
      break;
    }
  }
  return commentLines.join(' ');
}

// Language-specific Symbol Parsers
function parseSymbols(content, language, filePath) {
  const symbols = [];
  const lines = content.split(/\r?\n/);
  const langLower = (language || '').toLowerCase();

  // IMPORTANT: Order matters! Check javascript / typescript first because 'javascript'.includes('java') is true!
  const isJsTs =
    langLower.includes('javascript') ||
    langLower.includes('typescript') ||
    langLower.includes('jsx') ||
    langLower.includes('tsx') ||
    filePath.endsWith('.js') ||
    filePath.endsWith('.ts') ||
    filePath.endsWith('.jsx') ||
    filePath.endsWith('.tsx');

  const isPython = langLower.includes('python') || filePath.endsWith('.py');
  const isJava = !isJsTs && (langLower.includes('java') || filePath.endsWith('.java'));

  if (isJsTs) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Function declaration: function foo(...)
      let match = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s*([A-Za-z0-9_$]+)\s*\(/);
      if (match) {
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: match[1],
          type: 'Function',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      // Arrow function / function expression: const foo = (async)? (...) =>
      match = trimmed.match(
        /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/
      );
      if (match) {
        const startLine = i + 1;
        const arrowIdx = line.indexOf('=>');
        let searchIndex = i;
        if (line.slice(arrowIdx).includes('{')) {
          searchIndex = i;
        } else {
          for (let j = i; j < Math.min(lines.length, i + 5); j++) {
            if (lines[j].includes('{')) {
              searchIndex = j;
              break;
            }
          }
        }
        const endLine = findClosingBraceLine(lines, searchIndex);
        symbols.push({
          name: match[1],
          type: 'ArrowFunction',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      // Class declaration: class Foo [extends Bar] {
      match = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z0-9_$]+)/);
      if (match) {
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: match[1],
          type: 'Class',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      // Express Route: router.get('/path', ...) or app.post(...)
      match = trimmed.match(/(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*(['"`][^'"`]+['"`])/);
      if (match) {
        const method = match[1].toUpperCase();
        const routePath = match[2].replace(/['"`]/g, '');
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: `${method} ${routePath}`,
          type: 'Route',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      // Method in class or object literal: methodName(...) {
      match = trimmed.match(/^(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/);
      if (
        match &&
        !['if', 'for', 'while', 'switch', 'catch', 'function'].includes(match[1])
      ) {
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: match[1],
          type: 'Method',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
      }
    }
  } else if (isPython) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const indent = line.search(/\S/);

      // def function_name(...):
      let match = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
      if (match) {
        const startLine = i + 1;
        const endLine = findPythonBlockEnd(lines, i, indent);
        symbols.push({
          name: match[1],
          type: trimmed.includes('self') ? 'Method' : 'Function',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      // class ClassName:
      match = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
      if (match) {
        const startLine = i + 1;
        const endLine = findPythonBlockEnd(lines, i, indent);
        symbols.push({
          name: match[1],
          type: 'Class',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
      }
    }
  } else if (isJava) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      let match = trimmed.match(/(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?class\s+([A-Za-z0-9_]+)/);
      if (match) {
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: match[1],
          type: 'Class',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
        continue;
      }

      match = trimmed.match(/(?:public|protected|private|static|\s)+[\w<>\[\]]+\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/);
      if (match && !['if', 'for', 'while', 'switch'].includes(match[1])) {
        const startLine = i + 1;
        const endLine = findClosingBraceLine(lines, i);
        symbols.push({
          name: match[1],
          type: 'Method',
          startLine,
          endLine,
          docstring: extractDocstring(lines, i)
        });
      }
    }
  }

  return symbols;
}

// Slice content safely to exact line numbers (1-indexed)
function getSliceContent(lines, startLine, endLine) {
  const s = Math.max(0, startLine - 1);
  const e = Math.min(lines.length, endLine);
  return lines.slice(s, e).join('\n');
}

// Index all files in a repository
async function indexRepository(repositoryId, files) {
  const repo = await Repository.findById(repositoryId);
  if (!repo) throw new Error(`Repository not found: ${repositoryId}`);

  repo.indexingStatus = 'indexing';
  await repo.save();

  const chunksToInsert = [];
  const languageSummary = {};
  let totalSymbols = 0;
  let totalLines = 0;

  for (const file of files) {
    const filePath = file.path || file.relativePath;
    if (typeof filePath !== 'string' || !filePath) continue;

    const language = file.language || detectLanguage(filePath);
    languageSummary[language] = (languageSummary[language] || 0) + 1;

    const content = typeof file.content === 'string'
      ? file.content
      : (await readFileContent(file.fullPath)) || '';
    const lines = content.split(/\r?\n/);
    totalLines += lines.length;

    // 1. AST symbol parsing
    const symbols = parseSymbols(content, language, filePath);
    totalSymbols += symbols.length;

    const coveredRanges = [];

    for (const sym of symbols) {
      const chunkContent = getSliceContent(lines, sym.startLine, sym.endLine);
      const tokens = tokenize(`${sym.name} ${sym.docstring} ${chunkContent}`);
      const embedding = generateEmbedding(`${sym.name} ${sym.docstring} ${chunkContent}`);

      chunksToInsert.push({
        repositoryId,
        filePath,
        symbolName: sym.name,
        symbolType: sym.type,
        content: chunkContent,
        docstring: sym.docstring,
        startLine: sym.startLine,
        endLine: sym.endLine,
        language,
        tokens,
        embedding
      });

      coveredRanges.push({ start: sym.startLine, end: sym.endLine });
    }

    // 2. Fallback chunking for files with unparsed sections (40 lines with 5 overlap)
    const CHUNK_SIZE = 40;
    const OVERLAP = 5;

    if (symbols.length === 0 || lines.length > 50) {
      let currentLine = 1;
      while (currentLine <= lines.length) {
        const startLine = currentLine;
        const endLine = Math.min(lines.length, currentLine + CHUNK_SIZE - 1);

        // Check if this chunk is already tightly covered by an exact symbol
        const alreadyCovered = coveredRanges.some(
          (r) => r.start <= startLine && r.end >= endLine
        );

        if (!alreadyCovered) {
          const chunkContent = getSliceContent(lines, startLine, endLine);
          if (chunkContent.trim().length > 0) {
            const tokens = tokenize(chunkContent);
            const embedding = generateEmbedding(chunkContent);

            chunksToInsert.push({
              repositoryId,
              filePath,
              symbolName: '',
              symbolType: 'Block',
              content: chunkContent,
              docstring: '',
              startLine,
              endLine,
              language,
              tokens,
              embedding
            });
          }
        }

        currentLine += CHUNK_SIZE - OVERLAP;
        if (endLine >= lines.length) break;
      }
    }
  }

  // Remove existing chunks for this repository to ensure idempotency
  await CodeChunk.deleteMany({ repositoryId });

  // Insert all generated chunks
  if (chunksToInsert.length > 0) {
    await CodeChunk.insertMany(chunksToInsert);
  }

  // Update repository metadata
  repo.totalFiles = files.length;
  repo.totalSymbols = totalSymbols;
  repo.totalSnippets = chunksToInsert.length;
  repo.totalLines = totalLines;
  repo.languageSummary = languageSummary;
  repo.indexingStatus = 'completed';
  repo.error = null;
  await repo.save();

  return {
    repositoryId,
    totalFiles: files.length,
    totalSymbols,
    totalSnippets: chunksToInsert.length,
    totalLines,
    languageSummary
  };
}

module.exports = {
  tokenize,
  generateEmbedding,
  parseSymbols,
  indexRepository
};
