const CodeChunk = require('../models/codechunk');
const Repository = require('../models/repository');
const { tokenize, generateEmbedding } = require('./codeIndexer');

// Cosine similarity between two unit vectors
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  let dotProduct = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dotProduct));
}

// Okapi BM25 Lexical Search Implementation
function calculateBM25(chunks, queryTokens) {
  const N = chunks.length;
  if (N === 0 || queryTokens.length === 0) return new Map();

  // 1. Calculate Document Frequency (DF) for each query token
  const df = {};
  for (const token of queryTokens) {
    df[token] = 0;
    for (const chunk of chunks) {
      if (chunk.tokens && chunk.tokens.includes(token)) {
        df[token]++;
      }
    }
  }

  // 2. Average document length (in tokens)
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.tokens ? chunk.tokens.length : 0;
  }
  const avgdl = totalLength / N || 1;

  // BM25 parameters
  const k1 = 1.5;
  const b = 0.75;
  const scores = new Map();

  for (const chunk of chunks) {
    let score = 0;
    const docLen = chunk.tokens ? chunk.tokens.length : 0;

    for (const token of queryTokens) {
      const docFreq = df[token] || 0;
      if (docFreq === 0) continue;

      // IDF with standard smoothing
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));

      // Term frequency in this chunk
      let tf = 0;
      if (chunk.tokens) {
        for (const t of chunk.tokens) {
          if (t === token) tf++;
        }
      }

      if (tf > 0) {
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLen / avgdl));
        score += idf * (numerator / denominator);
      }
    }

    scores.set(chunk._id ? chunk._id.toString() : chunk.id, score);
  }

  return scores;
}

// AST Symbol Search
function calculateSymbolScores(chunks, queryTokens, rawQuery) {
  const scores = new Map();
  const lowerRaw = (rawQuery || '').toLowerCase();

  for (const chunk of chunks) {
    const chunkId = chunk._id ? chunk._id.toString() : chunk.id;
    let score = 0;

    if (chunk.symbolName) {
      const symLower = chunk.symbolName.toLowerCase();
      // Exact symbol match
      if (lowerRaw.includes(symLower) || symLower.includes(lowerRaw)) {
        score += 3.0;
      }

      // Token overlap with symbol name
      const symTokens = tokenize(chunk.symbolName);
      for (const qt of queryTokens) {
        if (symTokens.includes(qt)) {
          score += 1.5;
        }
      }

      // Bonus for functions / routes matching common query intents
      if (chunk.symbolType === 'Route' && (lowerRaw.includes('route') || lowerRaw.includes('api') || lowerRaw.includes('endpoint'))) {
        score += 1.0;
      }
    }

    // Path match bonus
    if (chunk.filePath) {
      const pathLower = chunk.filePath.toLowerCase();
      for (const qt of queryTokens) {
        if (pathLower.includes(qt)) {
          score += 0.8;
        }
      }
    }

    scores.set(chunkId, score);
  }

  return scores;
}

// Hybrid Search Coordinator
async function search({ repositoryId, query, mode = 'hybrid', limit = 5 }) {
  if (!query || !query.trim()) {
    return { results: [], repository: null, query: '' };
  }

  const repo = await Repository.findById(repositoryId);
  const repositoryName = repo ? repo.name : 'Repository';

  // Fetch all chunks for this repository
  const chunks = await CodeChunk.find({ repositoryId }).lean();
  if (!chunks || chunks.length === 0) {
    return {
      results: [],
      repository: repo,
      repositoryName,
      query,
      stats: { totalChunks: 0 }
    };
  }

  const queryTokens = tokenize(query);
  const queryEmbedding = generateEmbedding(query);

  // 1. BM25 Lexical scores
  const bm25Map = calculateBM25(chunks, queryTokens);
  let maxBM25 = 0;
  for (const val of bm25Map.values()) {
    if (val > maxBM25) maxBM25 = val;
  }

  // 2. AST Symbol scores
  const symbolMap = calculateSymbolScores(chunks, queryTokens, query);
  let maxSymbol = 0;
  for (const val of symbolMap.values()) {
    if (val > maxSymbol) maxSymbol = val;
  }

  // 3. Vector Similarity scores
  const vectorMap = new Map();
  for (const chunk of chunks) {
    const chunkId = chunk._id ? chunk._id.toString() : chunk.id;
    const sim = cosineSimilarity(queryEmbedding, chunk.embedding || []);
    vectorMap.set(chunkId, sim);
  }

  // 4. Combine into final scored list
  const scoredChunks = chunks.map((chunk) => {
    const chunkId = chunk._id ? chunk._id.toString() : chunk.id;
    const rawBM25 = bm25Map.get(chunkId) || 0;
    const rawSymbol = symbolMap.get(chunkId) || 0;
    const vectorScore = vectorMap.get(chunkId) || 0;

    const normBM25 = maxBM25 > 0 ? rawBM25 / maxBM25 : 0;
    const normSymbol = maxSymbol > 0 ? rawSymbol / maxSymbol : 0;

    let finalScore = 0;
    const reasons = [];

    if (mode === 'lexical') {
      finalScore = normBM25;
      if (rawBM25 > 0) reasons.push(`BM25 Lexical score: ${rawBM25.toFixed(2)}`);
    } else if (mode === 'semantic') {
      finalScore = vectorScore;
      if (vectorScore > 0) reasons.push(`Vector similarity: ${(vectorScore * 100).toFixed(1)}%`);
    } else if (mode === 'symbol') {
      finalScore = normSymbol;
      if (rawSymbol > 0) reasons.push(`Symbol AST match: ${chunk.symbolName || chunk.filePath}`);
    } else {
      // Hybrid default: 40% BM25 + 20% Symbol + 40% Vector
      finalScore = 0.4 * normBM25 + 0.2 * normSymbol + 0.4 * vectorScore;

      if (chunk.symbolName && rawSymbol > 0) {
        reasons.push(`Symbol AST match (${chunk.symbolType}: ${chunk.symbolName})`);
      }
      if (normBM25 > 0.3) {
        reasons.push(`Lexical keyword match`);
      }
      if (vectorScore > 0.4) {
        reasons.push(`Semantic concept alignment (${(vectorScore * 100).toFixed(0)}%)`);
      }
      if (reasons.length === 0) {
        reasons.push(`Ranked by hybrid code retrieval`);
      }
    }

    return {
      chunkId,
      filePath: chunk.filePath,
      symbolName: chunk.symbolName,
      symbolType: chunk.symbolType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      content: chunk.content,
      docstring: chunk.docstring,
      score: Number(finalScore.toFixed(4)),
      matchReasons: reasons,
      breakdown: {
        bm25: Number(normBM25.toFixed(3)),
        symbol: Number(normSymbol.toFixed(3)),
        vector: Number(vectorScore.toFixed(3))
      }
    };
  });

  // Sort by score descending
  scoredChunks.sort((a, b) => b.score - a.score);

  // Deduplicate overlapping segments from the exact same file
  const deduplicated = [];
  const seenRanges = new Set();

  for (const item of scoredChunks) {
    const key = `${item.filePath}:${item.startLine}-${item.endLine}`;
    if (!seenRanges.has(key)) {
      seenRanges.add(key);
      deduplicated.push(item);
    }
    if (deduplicated.length >= limit) break;
  }

  return {
    results: deduplicated,
    repository: repo,
    repositoryName,
    query,
    mode,
    stats: {
      totalChunks: chunks.length,
      returnedCount: deduplicated.length,
      topScore: deduplicated[0] ? deduplicated[0].score : 0
    }
  };
}

module.exports = {
  calculateBM25,
  calculateSymbolScores,
  cosineSimilarity,
  search
};