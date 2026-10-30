const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard');
const wrapAsync = require('../utils/wrapAsync');

router.get('/', wrapAsync(dashboardController.getDashboard));

module.exports = router;