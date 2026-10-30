const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search');
const wrapAsync = require('../utils/wrapAsync');

router.get('/', wrapAsync(searchController.getSearchPage));
router.post('/', wrapAsync(searchController.executeSearch));
router.get('/query', wrapAsync(searchController.executeSearch));

module.exports = router;