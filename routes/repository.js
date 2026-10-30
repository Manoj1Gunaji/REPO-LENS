const express = require('express');
const router = express.Router();
const multer = require('multer');
const repositoryController = require('../controllers/repository');
const wrapAsync = require('../utils/wrapAsync');

// Memory storage for ZIP file processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// Render upload page
router.get('/upload', wrapAsync(repositoryController.getUploadPage));
router.get('/', wrapAsync(repositoryController.getRepositories));

// ZIP archive upload
router.post('/upload', upload.single('repository'), wrapAsync(repositoryController.uploadZip));

// Local directory index
router.post('/local', wrapAsync(repositoryController.indexLocal));

// Instant demo seed
router.post('/demo', wrapAsync(repositoryController.loadDemo));

// Delete repository
router.delete('/:id', wrapAsync(repositoryController.deleteRepository));

module.exports = router;