exports.getHome = async (req, res, next) => {
  try {
    res.render('home', {
      title: 'CodeLens AI — Understand Any Codebase. Find Every Function.',
      activePage: 'home'
    });
  } catch (error) {
    next(error);
  }
};