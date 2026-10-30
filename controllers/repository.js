const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const axios = require('axios');
const Repository = require('../models/repository');
const CodeChunk = require('../models/codechunk');
const { extractZip, scanDirectory, getLanguageByFilename } = require('../services/fileScanner');
const { indexRepository } = require('../services/codeIndexer');
const { getCurrentRepository, setCurrentRepository } = require('../utils/repositorySelection');

// Render upload page
exports.getUploadPage = async (req, res, next) => {
  try {
    const repositories = await Repository.find({}).lean();
    const currentRepo = getCurrentRepository(repositories, req);

    res.render('upload', {
      title: 'CodeLens AI | Ingestion Engine',
      activePage: 'upload',
      currentRepo
    });
  } catch (error) {
    next(error);
  }
};

// Handle ZIP file upload
exports.uploadZip = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).send('Please choose a ZIP archive to upload.');
    }

    const repoName =
      req.body.repositoryName?.trim() ||
      path.parse(req.file.originalname).name ||
      'Uploaded Repository';

    const repo = await Repository.create({
      name: repoName,
      originalFileName: req.file.originalname,
      storagePath: '',
      indexingStatus: 'indexing'
    });

    const repoId = repo._id ? repo._id.toString() : repo.id;
    const destDir = path.join(__dirname, '..', 'uploads', repoId);

    // Extract with ZIP slip defenses
    const extracted = await extractZip(req.file.buffer, destDir);

    // Index all source files
    const indexResult = await indexRepository(repoId, extracted);
    setCurrentRepository(req, repoId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        repositoryId: repoId,
        name: repoName,
        ...indexResult
      });
    }

    res.redirect('/explorer');
  } catch (error) {
    next(error);
  }
};

// Handle local directory indexing
exports.indexLocal = async (req, res, next) => {
  try {
    const { directoryPath, repositoryName } = req.body;
    if (!directoryPath || !directoryPath.trim()) {
      return res.status(400).send('Directory path is required.');
    }

    const inputPath = directoryPath.trim();
    if (/^https?:\/\//i.test(inputPath)) {
      req.body.repositoryUrl = inputPath;
      return exports.indexGitHub(req, res, next);
    }

    const resolvedPath = path.resolve(inputPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(400).send(`Directory not found: ${resolvedPath}`);
    }

    const repoName = repositoryName?.trim() || path.basename(resolvedPath) || 'Local Repository';

    const repo = await Repository.create({
      name: repoName,
      storagePath: resolvedPath,
      indexingStatus: 'indexing'
    });

    const repoId = repo._id ? repo._id.toString() : repo.id;
    const files = await scanDirectory(resolvedPath);

    if (files.length === 0) {
      return res.status(400).send('No valid source code files found in the specified directory.');
    }

    const indexResult = await indexRepository(repoId, files);
    setCurrentRepository(req, repoId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        repositoryId: repoId,
        name: repoName,
        ...indexResult
      });
    }

    res.redirect('/explorer');
  } catch (error) {
    next(error);
  }
};

// Index a public GitHub repository from its HTTPS URL.
exports.indexGitHub = async (req, res, next) => {
  let repo;
  let destinationDir;

  try {
    const repositoryUrl = (req.body.repositoryUrl || req.body.directoryPath || '').trim();
    let parsedUrl;
    try {
      parsedUrl = new URL(repositoryUrl);
    } catch {
      return res.status(400).send('Enter a valid public GitHub repository URL.');
    }

    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    const owner = parts[0];
    const repository = (parts[1] || '').replace(/\.git$/i, '');
    const validSegment = /^[A-Za-z0-9_.-]+$/;
    if (
      parsedUrl.protocol !== 'https:' ||
      parsedUrl.hostname.toLowerCase() !== 'github.com' ||
      parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash ||
      parts.length !== 2 || !validSegment.test(owner || '') || !validSegment.test(repository) ||
      owner === '.' || owner === '..' || repository === '.' || repository === '..'
    ) {
      return res.status(400).send('Use a public GitHub URL in the format https://github.com/owner/repository.');
    }

    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
    const requestConfig = {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CodeLens-AI'
      },
      timeout: 30000
    };

    let repositoryInfo;
    try {
      const response = await axios.get(apiUrl, requestConfig);
      repositoryInfo = response.data;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) {
        return res.status(400).send('GitHub repository not found or not public.');
      }
      if (status === 403 || status === 429) {
        return res.status(503).send('GitHub rate limit reached. Please try again later or upload the repository ZIP.');
      }
      return res.status(502).send('Could not reach GitHub. Check the server connection and try again.');
    }

    const archiveUrl = `${apiUrl}/zipball/${encodeURIComponent(repositoryInfo.default_branch)}`;
    let archive;
    try {
      const response = await axios.get(archiveUrl, {
        ...requestConfig,
        responseType: 'arraybuffer',
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024
      });
      archive = Buffer.from(response.data);
    } catch (error) {
      if (error.response?.status === 404) {
        return res.status(400).send('The repository default branch could not be downloaded.');
      }
      return res.status(502).send('Could not download the GitHub repository archive.');
    }

    const repositoryName = req.body.repositoryName?.trim() || repositoryInfo.name || repository;
    repo = await Repository.create({
      name: repositoryName,
      originalFileName: `${owner}-${repository}.zip`,
      indexingStatus: 'indexing'
    });

    const repoId = repo._id ? repo._id.toString() : repo.id;
    destinationDir = path.join(__dirname, '..', 'uploads', repoId);
    await extractZip(archive, destinationDir);
    const files = await scanDirectory(destinationDir);

    if (files.length === 0) {
      await Repository.deleteOne({ _id: repo._id });
      await fsPromises.rm(destinationDir, { recursive: true, force: true });
      return res.status(400).send('No supported source files were found in that GitHub repository.');
    }

    repo.storagePath = destinationDir;
    await repo.save();
    const indexResult = await indexRepository(repoId, files);
    setCurrentRepository(req, repoId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        repositoryId: repoId,
        name: repositoryName,
        ...indexResult
      });
    }

    res.redirect('/explorer');
  } catch (error) {
    if (repo) {
      await Repository.deleteOne({ _id: repo._id }).catch(() => {});
    }
    if (destinationDir) {
      await fsPromises.rm(destinationDir, { recursive: true, force: true }).catch(() => {});
    }
    next(error);
  }
};

// Seed/Load Instant Demo Repository (TaskMaster API)
exports.loadDemo = async (req, res, next) => {
  try {
    const demoFiles = [
      {
        path: 'package.json',
        language: 'JSON',
        content: JSON.stringify(
          {
            name: 'taskmaster-api',
            version: '2.4.0',
            description: 'TaskMaster Enterprise Backend Service',
            main: 'server.js',
            scripts: { start: 'node server.js', dev: 'nodemon server.js' },
            dependencies: {
              express: '^4.18.2',
              mongoose: '^7.5.0',
              bcryptjs: '^2.4.3',
              jsonwebtoken: '^9.0.2',
              multer: '^1.4.5-lts.1',
              dotenv: '^16.3.1',
              node_cron: '^3.0.2'
            }
          },
          null,
          2
        )
      },
      {
        path: 'server/config/database.js',
        language: 'JavaScript',
        content: `const mongoose = require('mongoose');

/**
 * Connect to MongoDB Cluster
 * Handles connection lifecycle and connection pool events.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/taskmaster', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(\`MongoDB Connected: \${conn.connection.host}\`);
    return conn;
  } catch (error) {
    console.error(\`Database connection error: \${error.message}\`);
    process.exit(1);
  }
};

module.exports = { connectDB };`
      },
      {
        path: 'server/controllers/authController.js',
        language: 'JavaScript',
        content: `const User = require('../models/userModel');
const jwt = require('jsonwebtoken');

/**
 * Generate signed JWT token
 */
const generateToken = (userId, role) => {
  return jwt.sign({ id: userId, role }, process.env.JWT_SECRET || 'secret_key_123', {
    expiresIn: '7d',
  });
};

/**
 * Authenticate user credentials and return session token
 */
const authenticateUser = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (user && (await user.comparePassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.role),
    });
  } else {
    res.status(401).json({ message: 'Invalid email or password credentials' });
  }
};

/**
 * Register a new user account
 */
const registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  const userExists = await User.findOne({ email });

  if (userExists) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const user = await User.create({ name, email, password });
  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    token: generateToken(user._id, user.role),
  });
};

module.exports = { authenticateUser, registerUser, generateToken };`
      },
      {
        path: 'server/controllers/taskController.js',
        language: 'JavaScript',
        content: `const Task = require('../models/taskModel');

/**
 * Retrieve all tasks for the authenticated user from the database
 */
const getTasks = async (req, res) => {
  const tasks = await Task.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(tasks);
};

/**
 * Retrieve a specific task by its identifier
 */
const getTaskById = async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }
  res.json(task);
};

/**
 * Create a new task entry in the database
 */
const createTask = async (req, res) => {
  const { title, description, priority, dueDate } = req.body;
  const task = await Task.create({
    user: req.user._id,
    title,
    description,
    priority: priority || 'medium',
    dueDate,
  });
  res.status(201).json(task);
};

/**
 * Update an existing task in the database
 */
const updateTask = async (req, res) => {
  const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(task);
};

module.exports = { getTasks, getTaskById, createTask, updateTask };`
      },
      {
        path: 'server/models/userModel.js',
        language: 'JavaScript',
        content: `const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true }
);

/**
 * Hash password with bcrypt before saving to MongoDB
 */
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Compare entered password with salted hash
 */
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);`
      },
      {
        path: 'server/models/taskModel.js',
        language: 'JavaScript',
        content: `const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Task', taskSchema);`
      },
      {
        path: 'server/middleware/authMiddleware.js',
        language: 'JavaScript',
        content: `const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

/**
 * Verify JWT token from Authorization Bearer header
 */
const verifyToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key_123');
      req.user = await User.findById(decoded.id).select('-password');
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }
  return res.status(401).json({ message: 'Not authorized, no token provided' });
};

/**
 * Check user role for administrative permissions
 */
const checkRole = (role) => {
  return (req, res, next) => {
    if (req.user && req.user.role === role) {
      next();
    } else {
      res.status(403).json({ message: \`Access forbidden: requires \${role} role\` });
    }
  };
};

module.exports = { verifyToken, checkRole };`
      },
      {
        path: 'server/middleware/validator.js',
        language: 'JavaScript',
        content: `/**
 * Validate incoming request body for task creation
 */
const validateTask = (req, res, next) => {
  const { title, priority } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'Title is required and must not be empty' });
  }

  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'Priority must be low, medium, or high' });
  }

  next();
};

/**
 * Validate user registration payload
 */
const validateUser = (req, res, next) => {
  const { name, email, password } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  next();
};

module.exports = { validateTask, validateUser };`
      },
      {
        path: 'server/middleware/errorHandler.js',
        language: 'JavaScript',
        content: `/**
 * Global application error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

const notFound = (req, res, next) => {
  const error = new Error(\`Not Found - \${req.originalUrl}\`);
  res.status(404);
  next(error);
};

module.exports = { errorHandler, notFound };`
      },
      {
        path: 'server/routes/uploadRoutes.js',
        language: 'JavaScript',
        content: `const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, \`\${Date.now()}-\${file.originalname}\`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.pdf', '.zip'].includes(ext)) {
      return cb(new Error('Only images, PDFs, and ZIPs are allowed'));
    }
    cb(null, true);
  },
});

/**
 * POST /api/upload - Handle file upload
 */
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({
    message: 'File uploaded successfully',
    filename: req.file.filename,
    path: req.file.path,
    size: req.file.size,
  });
});

module.exports = router;`
      },
      {
        path: 'server/routes/index.js',
        language: 'JavaScript',
        content: `const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const taskRoutes = require('./taskRoutes');
const uploadRoutes = require('./uploadRoutes');

// API Routes Registration
router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/upload', uploadRoutes);

module.exports = router;`
      },
      {
        path: 'server/services/cronService.js',
        language: 'JavaScript',
        content: `/**
 * Background Task Scheduler & Token Cleanup
 * Runs periodically to prune expired tokens and send daily digest emails.
 */
const cleanupExpiredTokens = async () => {
  console.log('[Cron Job] Cleaning up expired session tokens and temp files...');
  // Simulates removing tokens older than 7 days
  return { cleaned: 15, timestamp: new Date() };
};

const scheduleDailyDigest = () => {
  console.log('[Cron Job] Scheduled daily digest notification worker.');
};

module.exports = { cleanupExpiredTokens, scheduleDailyDigest };`
      }
    ];

    let demoRepo = await Repository.findOne({ name: 'TaskMaster API (Demo)' });
    if (!demoRepo) {
      demoRepo = await Repository.create({
        name: 'TaskMaster API (Demo)',
        originalFileName: 'taskmaster-api.zip',
        indexingStatus: 'indexing'
      });
    }

    const demoRepoId = demoRepo._id ? demoRepo._id.toString() : demoRepo.id;
    await indexRepository(demoRepoId, demoFiles);
    setCurrentRepository(req, demoRepoId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        message: 'TaskMaster API demo repository loaded and indexed successfully.',
        repositoryId: demoRepoId
      });
    }

    res.redirect('/dashboard');
  } catch (error) {
    next(error);
  }
};

// Get list of all repositories
exports.getRepositories = async (req, res, next) => {
  try {
    const repos = await Repository.find({}).lean();
    res.json(repos);
  } catch (error) {
    next(error);
  }
};

// Delete a repository
exports.deleteRepository = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Repository.findByIdAndDelete(id);
    await CodeChunk.deleteMany({ repositoryId: id });
    res.json({ success: true, message: 'Repository deleted' });
  } catch (error) {
    next(error);
  }
};
