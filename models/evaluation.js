const mongoose = require('mongoose');
const { createModel } = require('./modelAdapter');

const evaluationSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: String,
      required: true,
      index: true
    },
    repositoryName: {
      type: String,
      default: ''
    },
    query: {
      type: String,
      default: ''
    },
    searchMode: {
      type: String,
      default: 'hybrid'
    },
    recallAt5: {
      type: Number,
      default: 0
    },
    mrr: {
      type: Number,
      default: 0
    },
    passedCount: {
      type: Number,
      default: 0
    },
    partialCount: {
      type: Number,
      default: 0
    },
    failedCount: {
      type: Number,
      default: 0
    },
    queries: {
      type: Array,
      default: []
    },
    resultCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

const Evaluation = createModel('Evaluation', evaluationSchema);
module.exports = Evaluation;