const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluation');
const wrapAsync = require('../utils/wrapAsync');

router.get('/', wrapAsync(evaluationController.getEvaluationPage));
router.post('/run', wrapAsync(evaluationController.runEvaluation));
router.get('/run', wrapAsync(evaluationController.runEvaluation));

module.exports = router;