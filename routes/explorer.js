const express = require('express');
const router = express.Router();
const explorerController = require('../controllers/explorer');
const wrapAsync = require('../utils/wrapAsync');

// Render Explorer View
router.get('/', wrapAsync(explorerController.getExplorer));

// JSON API endpoints
router.get('/tree', wrapAsync(explorerController.getFileTree));
router.get('/file', wrapAsync(explorerController.getFileContent));
router.get('/symbols', wrapAsync(explorerController.getSymbols));

module.exports = router;