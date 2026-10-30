const Repository = require('../models/repository');
const Evaluation = require('../models/evaluation');
const { search } = require('../services/hybridSearch');
const { generateExplanation } = require('../services/featherlessAI');
const { getCurrentRepository, getRepositoryId } = require('../utils/repositorySelection');

// Render search landing page
exports.getSearchPage = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    const currentRepo = getCurrentRepository(repositories, req);

    res.render('search', {
      title: 'CodeLens AI | AI Code Search',
      activePage: 'search',
      currentRepo,
      repositories
    });
  } catch (error) {
    next(error);
  }
};

// Execute Search (POST or GET)
exports.executeSearch = async (req, res, next) => {
  try {
    const query = req.body?.query || req.query?.q || '';
    const mode = req.body?.mode || req.query?.mode || 'hybrid';
    const limit = parseInt(req.body?.limit || req.query?.limit || 5, 10);

    if (!query || !query.trim()) {
      return res.redirect('/search');
    }

    const repositories = await Repository.find({}).lean();
    let repositoryId = req.body?.repositoryId || req.query?.repositoryId;

    if (!repositoryId) repositoryId = getRepositoryId(getCurrentRepository(repositories, req));

    if (!repositoryId) {
      return res.render('search', {
        title: 'CodeLens AI | AI Code Search',
        activePage: 'search',
        error: 'No indexed repositories found. Please upload or load a repository first.',
        currentRepo: null,
        repositories: []
      });
    }

    const repo = await Repository.findById(repositoryId);
    const repositoryName = repo ? repo.name : 'Repository';

    // 1. Run hybrid retrieval
    const searchRes = await search({
      repositoryId,
      query: query.trim(),
      mode,
      limit
    });

    // 2. Generate grounded AI explanation citing evidence
    const aiResponse = await generateExplanation({
      query: query.trim(),
      evidenceList: searchRes.results,
      repositoryName
    });

    // 3. Log search query to search history
    await Evaluation.create({
      repositoryId,
      repositoryName,
      query: query.trim(),
      searchMode: mode,
      resultCount: searchRes.results.length,
      queries: [
        {
          query: query.trim(),
          topResult: searchRes.results[0]
            ? {
                filePath: searchRes.results[0].filePath,
                symbolName: searchRes.results[0].symbolName,
                score: searchRes.results[0].score
              }
            : null
        }
      ]
    });

    // Return JSON if API request
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        query: query.trim(),
        mode,
        repositoryId,
        repositoryName,
        results: searchRes.results,
        aiResponse,
        stats: searchRes.stats
      });
    }

    // Render results view
    res.render('results', {
      title: `Search: "${query.trim()}" — CodeLens AI`,
      activePage: 'search',
      query: query.trim(),
      mode,
      repositoryId,
      repositoryName,
      results: searchRes.results,
      aiResponse,
      stats: searchRes.stats
    });
  } catch (error) {
    next(error);
  }
};
