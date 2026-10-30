const Repository = require('../models/repository');
const Evaluation = require('../models/evaluation');
const { search } = require('./hybridSearch');

const GOLDEN_EVALUATION_QUESTIONS = [
  {
    id: 1,
    query: 'Where is user authentication implemented?',
    expectedFiles: ['authController.js', 'authMiddleware.js', 'userModel.js'],
    expectedSymbols: ['login', 'register', 'authenticateUser', 'generateToken']
  },
  {
    id: 2,
    query: 'Where is data retrieved from the database?',
    expectedFiles: ['taskController.js', 'database.js', 'userModel.js'],
    expectedSymbols: ['getTasks', 'getTaskById', 'find', 'findById']
  },
  {
    id: 3,
    query: 'Where is input validation performed?',
    expectedFiles: ['validator.js', 'taskValidator.js', 'validate.js'],
    expectedSymbols: ['validateTask', 'validateUser', 'validateRequest']
  },
  {
    id: 4,
    query: 'Where are file uploads processed?',
    expectedFiles: ['uploadRoutes.js', 'fileUpload.js', 'multerConfig.js'],
    expectedSymbols: ['uploadFile', 'handleUpload', 'upload']
  },
  {
    id: 5,
    query: 'Where are permissions and authorization checked?',
    expectedFiles: ['authMiddleware.js', 'roleCheck.js'],
    expectedSymbols: ['checkRole', 'requireAdmin', 'authorize', 'verifyToken']
  },
  {
    id: 6,
    query: 'Where is error handling configured?',
    expectedFiles: ['errorHandler.js', 'ExpressError.js', 'app.js'],
    expectedSymbols: ['errorHandler', 'notFound', 'ExpressError']
  },
  {
    id: 7,
    query: 'Where are API routes registered?',
    expectedFiles: ['index.js', 'taskRoutes.js', 'authRoutes.js', 'app.js'],
    expectedSymbols: ['router', 'app.use', 'routes']
  },
  {
    id: 8,
    query: 'Where is the database connection established?',
    expectedFiles: ['database.js', 'db.js', 'connection.js'],
    expectedSymbols: ['connectDB', 'initDatabase', 'mongoose.connect']
  },
  {
    id: 9,
    query: 'Where is password hashing performed?',
    expectedFiles: ['userModel.js', 'authController.js', 'hash.js'],
    expectedSymbols: ['hashPassword', 'comparePassword', 'bcrypt']
  },
  {
    id: 10,
    query: 'Where are background tasks or token cleanups executed?',
    expectedFiles: ['cronService.js', 'cleanupService.js', 'scheduler.js'],
    expectedSymbols: ['cleanupExpiredTokens', 'cronJob', 'schedule']
  }
];

// Run benchmark evaluation on a repository
async function runEvaluationBenchmark(repositoryId) {
  const startTime = Date.now();
  const repo = await Repository.findById(repositoryId);
  if (!repo) throw new Error(`Repository not found: ${repositoryId}`);

  const results = [];
  let recallHits = 0;
  let totalReciprocalRank = 0;
  let passedCount = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (const q of GOLDEN_EVALUATION_QUESTIONS) {
    const qStart = Date.now();
    const searchRes = await search({
      repositoryId,
      query: q.query,
      mode: 'hybrid',
      limit: 5
    });
    const latency = Date.now() - qStart;

    let hitRank = 0; // 1-indexed rank
    let matchedChunk = null;

    for (let i = 0; i < searchRes.results.length; i++) {
      const res = searchRes.results[i];
      const fileMatched = q.expectedFiles.some((ef) =>
        res.filePath.toLowerCase().includes(ef.toLowerCase())
      );
      const symbolMatched = q.expectedSymbols.some((es) =>
        (res.symbolName || '').toLowerCase().includes(es.toLowerCase())
      );

      if (fileMatched || symbolMatched) {
        hitRank = i + 1;
        matchedChunk = res;
        break;
      }
    }

    const recallAt5 = hitRank > 0 && hitRank <= 5 ? 1 : 0;
    const reciprocalRank = hitRank > 0 ? 1 / hitRank : 0;

    recallHits += recallAt5;
    totalReciprocalRank += reciprocalRank;

    let status = 'failed';
    if (hitRank === 1) {
      status = 'passed';
      passedCount++;
    } else if (hitRank > 1 && hitRank <= 5) {
      status = 'partial';
      partialCount++;
    } else {
      failedCount++;
    }

    results.push({
      id: q.id,
      query: q.query,
      status,
      hitRank: hitRank || 'Not in Top 5',
      reciprocalRank: Number(reciprocalRank.toFixed(3)),
      latencyMs: latency,
      topResult: searchRes.results[0]
        ? {
            filePath: searchRes.results[0].filePath,
            symbolName: searchRes.results[0].symbolName,
            lines: `${searchRes.results[0].startLine}-${searchRes.results[0].endLine}`,
            score: searchRes.results[0].score
          }
        : null,
      matchedResult: matchedChunk
        ? {
            filePath: matchedChunk.filePath,
            symbolName: matchedChunk.symbolName,
            lines: `${matchedChunk.startLine}-${matchedChunk.endLine}`,
            score: matchedChunk.score
          }
        : null
    });
  }

  const totalQuestions = GOLDEN_EVALUATION_QUESTIONS.length;
  const finalRecallAt5 = (recallHits / totalQuestions) * 100;
  const finalMRR = totalReciprocalRank / totalQuestions;
  const totalDuration = Date.now() - startTime;

  // Persist evaluation record
  const evalRecord = await Evaluation.create({
    repositoryId,
    repositoryName: repo.name,
    query: '10-Question Golden Evaluation Benchmark',
    searchMode: 'hybrid',
    recallAt5: Number(finalRecallAt5.toFixed(1)),
    mrr: Number(finalMRR.toFixed(3)),
    passedCount,
    partialCount,
    failedCount,
    queries: results,
    resultCount: results.length
  });

  return {
    evaluationId: evalRecord._id ? evalRecord._id.toString() : evalRecord.id,
    repositoryId,
    repositoryName: repo.name,
    totalQuestions,
    recallAt5: Number(finalRecallAt5.toFixed(1)),
    mrr: Number(finalMRR.toFixed(3)),
    passedCount,
    partialCount,
    failedCount,
    durationMs: totalDuration,
    results
  };
}

module.exports = {
  GOLDEN_EVALUATION_QUESTIONS,
  runEvaluationBenchmark
};