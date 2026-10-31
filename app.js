const express = require('express');
const path = require('path');
const ejsMate = require('ejs-mate');
const methodOverride = require('method-override');
const session = require('express-session');
require('dotenv').config();

const ExpressError = require('./utils/ExpressError');
const homeRoutes = require('./routes/home');
const dashboardRoutes = require('./routes/dashboard');
const repositoryRoutes = require('./routes/repository');
const explorerRoutes = require('./routes/explorer');
const searchRoutes = require('./routes/search');
const evaluationRoutes = require('./routes/evaluation');
const repositoryController = require('./controllers/repository');

const app = express();

// View Engine Setup
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsing Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Static Files Setup
app.use(express.static(path.join(__dirname, 'public')));
app.use('/js', express.static(path.join(__dirname, 'public', 'css', 'js')));
app.use('/css/js', express.static(path.join(__dirname, 'public', 'css', 'js')));

// Compatibility route for explorer.css
app.get('/css/explorer.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'css', 'style.css'));
});

// Session Configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'codelens_super_secure_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
  })
);

// Global Template Locals
app.use((req, res, next) => {
  res.locals.currUser = req.session.user || null;
  next();
});

// Primary Web Routes
app.use('/', homeRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/explorer', explorerRoutes);
app.use('/search', searchRoutes);
app.use('/evaluation', evaluationRoutes);

// Direct /upload view route
app.get('/upload', repositoryController.getUploadPage);

// Repository & Ingestion Routes (Supports both web and API paths)
app.use('/repositories', repositoryRoutes);
app.use('/api/repositories', repositoryRoutes);
app.use('/api/explorer', explorerRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/evaluation', evaluationRoutes);

// 404 Handler
app.use((req, res, next) => {
  next(new ExpressError(404, `Page Not Found: ${req.originalUrl}`));
});

// Global Error Handler
app.use((err, req, res, next) => {
  const { statusCode = 500, message = 'Internal Server Error' } = err;
  console.error(`[Error ${statusCode}]:`, err.message || err);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(statusCode).json({ error: message, statusCode });
  }

  res.status(statusCode).render('error', {
    title: `Error ${statusCode} — CodeLens AI`,
    statusCode,
    message
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(` REPO-LENS AI Engine is running on http://localhost:${PORT}`);

  // Auto-seed TaskMaster API demo repository on startup
  try {
    const Repository = require('./models/repository');
    const existingRepo = await Repository.findOne({ name: 'TaskMaster API (Demo)' });
    if (!existingRepo) {
      console.log('Seeding initial TaskMaster API demo repository...');
      const dummyReq = { body: {}, xhr: false, headers: {} };
      const dummyRes = { redirect: () => {}, json: () => {} };
      await repositoryController.loadDemo(dummyReq, dummyRes, (err) => {
        if (err) console.error('Demo seed error:', err.message);
      });
      console.log('TaskMaster API demo repository initialized and indexed.');
    }
  } catch (seedErr) {
    console.warn('Initial demo seed warning:', seedErr.message);
  }
});

