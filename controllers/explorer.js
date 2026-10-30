const Repository = require('../models/repository');
const CodeChunk = require('../models/codechunk');
const { getCurrentRepository, getRepositoryId } = require('../utils/repositorySelection');

// Render Explorer View
exports.getExplorer = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    const currentRepo = getCurrentRepository(repositories, req);

    res.render('explorer', {
      title: 'CodeLens AI | Code Explorer',
      activePage: 'explorer',
      currentRepo
    });
  } catch (error) {
    next(error);
  }
};

// Get File Tree for Repository
exports.getFileTree = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    if (repositories.length === 0) {
      return res.json({ files: [] });
    }

    const currentRepo = getCurrentRepository(repositories, req);
    const repoId = req.query.repositoryId || getRepositoryId(currentRepo);
    if (!repoId) return res.json({ files: [] });
    const chunks = await CodeChunk.find({ repositoryId: repoId }).lean();

    const fileMap = new Map();
    for (const chunk of chunks) {
      if (!fileMap.has(chunk.filePath)) {
        fileMap.set(chunk.filePath, {
          path: chunk.filePath,
          language: chunk.language || 'Plain Text',
          symbolCount: 0
        });
      }
      if (chunk.symbolName) {
        fileMap.get(chunk.filePath).symbolCount++;
      }
    }

    const files = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
    res.json({ files, repositoryId: repoId });
  } catch (error) {
    next(error);
  }
};

// Get Single File Content and AST Symbols
exports.getFileContent = async (req, res, next) => {
  try {
    const { filePath, repositoryId } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const repositories = await Repository.find({}).lean();
    const selectedRepoId = repositoryId || getRepositoryId(getCurrentRepository(repositories, req));
    let filter = { filePath };
    if (selectedRepoId) filter.repositoryId = selectedRepoId;

    const chunks = await CodeChunk.find(filter).lean();
    if (!chunks || chunks.length === 0) {
      return res.status(404).json({ error: 'File chunks not found' });
    }

    // Determine full file content from chunks
    // Chunks may be symbols or blocks; find block chunks or reconstructed content
    chunks.sort((a, b) => a.startLine - b.startLine);

    // Collect all symbols for this file
    const symbols = [];
    for (const chunk of chunks) {
      if (chunk.symbolName) {
        symbols.push({
          name: chunk.symbolName,
          type: chunk.symbolType,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          docstring: chunk.docstring
        });
      }
    }

    // Combine or pick largest block chunk to reconstruct file
    let maxEndLine = 0;
    for (const c of chunks) {
      if (c.endLine > maxEndLine) maxEndLine = c.endLine;
    }

    // Reconstruct full content from chunks
    const lineArray = new Array(maxEndLine).fill('');
    for (const chunk of chunks) {
      const chunkLines = chunk.content.split(/\r?\n/);
      for (let i = 0; i < chunkLines.length; i++) {
        const lineIdx = chunk.startLine - 1 + i;
        if (lineIdx < lineArray.length) {
          lineArray[lineIdx] = chunkLines[i];
        }
      }
    }

    const content = lineArray.join('\n');

    res.json({
      filePath,
      language: chunks[0].language || 'JavaScript',
      content,
      totalLines: maxEndLine,
      symbols
    });
  } catch (error) {
    next(error);
  }
};

// Get Symbols for a file or repository
exports.getSymbols = async (req, res, next) => {
  try {
    const { filePath, repositoryId } = req.query;
    const repositories = await Repository.find({}).lean();
    const selectedRepoId = repositoryId || getRepositoryId(getCurrentRepository(repositories, req));
    const filter = { symbolName: { $ne: '' } };
    if (filePath) filter.filePath = filePath;
    if (selectedRepoId) filter.repositoryId = selectedRepoId;

    const chunks = await CodeChunk.find(filter).lean();
    const symbols = chunks.map((c) => ({
      name: c.symbolName,
      type: c.symbolType,
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      docstring: c.docstring
    }));

    res.json({ symbols });
  } catch (error) {
    next(error);
  }
};
