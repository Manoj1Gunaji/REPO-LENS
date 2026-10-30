const getRepositoryId = (repository) => {
  if (!repository) return null;
  return repository._id ? repository._id.toString() : repository.id || null;
};

const getCurrentRepository = (repositories, req) => {
  if (!Array.isArray(repositories) || repositories.length === 0) return null;

  const selectedId = req?.session?.currentRepoId;
  const selected = selectedId && repositories.find((repository) => getRepositoryId(repository) === selectedId);
  if (selected) return selected;

  return repositories.reduce((newest, repository) => {
    if (!newest) return repository;
    const currentTime = new Date(repository.createdAt || 0).getTime();
    const newestTime = new Date(newest.createdAt || 0).getTime();
    return currentTime > newestTime ? repository : newest;
  }, null);
};

const setCurrentRepository = (req, repositoryId) => {
  if (req?.session && repositoryId) {
    req.session.currentRepoId = String(repositoryId);
  }
};

module.exports = { getRepositoryId, getCurrentRepository, setCurrentRepository };
