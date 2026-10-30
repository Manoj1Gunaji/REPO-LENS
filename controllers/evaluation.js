const Repository = require('../models/repository');
const Evaluation = require('../models/evaluation');
const { runEvaluationBenchmark } = require('../services/evaluationService');
const { getCurrentRepository, getRepositoryId } = require('../utils/repositorySelection');

// Render Evaluation Suite page
exports.getEvaluationPage = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    const currentRepo = getCurrentRepository(repositories, req);

    let evaluation = null;
    if (currentRepo) {
      const repoId = currentRepo._id ? currentRepo._id.toString() : currentRepo.id;
      evaluation = await Evaluation.findOne({ repositoryId: repoId, recallAt5: { $gt: 0 } }).sort({ createdAt: -1 }).lean();
    }

    res.render('evaluation', {
      title: 'CodeLens AI | Retrieval Benchmark & Evaluation',
      activePage: 'evaluation',
      currentRepo,
      evaluation
    });
  } catch (error) {
    next(error);
  }
};

// Run 10-Question Golden Evaluation Benchmark
exports.runEvaluation = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    if (repositories.length === 0) {
      return res.status(400).send('No repository indexed. Please upload or load demo repository first.');
    }

    const selectedRepo = getCurrentRepository(repositories, req);
    const repositoryId = req.body?.repositoryId || getRepositoryId(selectedRepo);
    const evalResult = await runEvaluationBenchmark(repositoryId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json(evalResult);
    }

    res.render('evaluation', {
      title: 'CodeLens AI | Retrieval Benchmark & Evaluation',
      activePage: 'evaluation',
      currentRepo: repositories.find((repo) => getRepositoryId(repo) === String(repositoryId)) || selectedRepo,
      evaluation: evalResult
    });
  } catch (error) {
    next(error);
  }
};
