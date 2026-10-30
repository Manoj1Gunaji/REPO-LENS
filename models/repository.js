const mongoose = require('mongoose');
const { createModel } = require('./modelAdapter');

const repositorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    originalFileName: {
      type: String,
      default: ''
    },
    storagePath: {
      type: String,
      default: ''
    },
    languageSummary: {
      type: Map,
      of: Number,
      default: {}
    },
    totalFiles: {
      type: Number,
      default: 0
    },
    totalSymbols: {
      type: Number,
      default: 0
    },
    totalSnippets: {
      type: Number,
      default: 0
    },
    totalLines: {
      type: Number,
      default: 0
    },
    totalSize: {
      type: Number,
      default: 0
    },
    indexingStatus: {
      type: String,
      enum: ['pending', 'indexing', 'completed', 'failed'],
      default: 'pending'
    },
    error: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const Repository = createModel('Repository', repositorySchema);
module.exports = Repository;