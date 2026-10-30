const mongoose = require('mongoose');
const { createModel } = require('./modelAdapter');

const codeChunkSchema = new mongoose.Schema(
  {
    repositoryId: {
      type: String,
      required: true,
      index: true
    },
    filePath: {
      type: String,
      required: true
    },
    symbolName: {
      type: String,
      default: ''
    },
    symbolType: {
      type: String,
      default: ''
    },
    content: {
      type: String,
      required: true
    },
    docstring: {
      type: String,
      default: ''
    },
    startLine: {
      type: Number,
      required: true
    },
    endLine: {
      type: Number,
      required: true
    },
    language: {
      type: String,
      default: ''
    },
    tokens: {
      type: [String],
      default: []
    },
    embedding: {
      type: [Number],
      default: []
    }
  },
  {
    timestamps: true
  }
);

codeChunkSchema.index({ repositoryId: 1, filePath: 1 });
codeChunkSchema.index({ repositoryId: 1, symbolName: 1 });

const CodeChunk = createModel('CodeChunk', codeChunkSchema);
module.exports = CodeChunk;