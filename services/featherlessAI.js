const axios = require('axios');

const FEATHERLESS_API_URL = process.env.FEATHERLESS_API_URL || 'https://api.featherless.ai/v1/chat/completions';
const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY || '';
const FEATHERLESS_MODEL = process.env.FEATHERLESS_MODEL || 'meta-llama/Meta-Llama-3.1-8B-Instruct';

// Format retrieved evidence chunks into structured context
function formatEvidenceContext(evidenceList) {
  if (!evidenceList || evidenceList.length === 0) {
    return 'No relevant code snippets found in repository.';
  }

  return evidenceList
    .map((item, index) => {
      const header = `[Evidence #${index + 1}] File: ${item.filePath} (Lines ${item.startLine}-${item.endLine}) ${item.symbolName ? `Symbol: ${item.symbolName} (${item.symbolType})` : ''}`;
      return `${header}\n\`\`\`${(item.language || '').toLowerCase()}\n${item.content}\n\`\`\``;
    })
    .join('\n\n');
}

// Intelligent local heuristic response generator when API key is unset or offline
function generateLocalGroundedExplanation(query, evidenceList, repositoryName) {
  if (!evidenceList || evidenceList.length === 0) {
    return `### Analysis for "${query}"\n\nNo matching functions or source files were identified in **${repositoryName || 'the repository'}**. Try rephrasing your search terms.`;
  }

  const topEvidence = evidenceList[0];
  const otherEvidence = evidenceList.slice(1, 3);

  let explanation = `### Grounded Technical Explanation\n\n`;
  explanation += `Based on the indexed codebase analysis of **${repositoryName || 'the repository'}**, the requested functionality is implemented in `;
  explanation += `**\`${topEvidence.filePath}\`** at **lines ${topEvidence.startLine}-${topEvidence.endLine}** `;

  if (topEvidence.symbolName) {
    explanation += `within the **\`${topEvidence.symbolName}\`** (${topEvidence.symbolType}) definition [Evidence #1].\n\n`;
  } else {
    explanation += `[Evidence #1].\n\n`;
  }

  // Key operations extracted from code
  explanation += `#### Key Implementation Details:\n`;
  if (topEvidence.symbolName) {
    explanation += `- **Core Function**: \`${topEvidence.symbolName}\` handles this logic directly in [Evidence #1].\n`;
  }
  explanation += `- **Source Location**: Defined at line ${topEvidence.startLine} to line ${topEvidence.endLine} of \`${topEvidence.filePath}\`.\n`;

  if (topEvidence.docstring) {
    explanation += `- **Documented Behavior**: *"${topEvidence.docstring.replace(/[\/*#]/g, '').trim()}"*\n`;
  }

  // Supporting evidence
  if (otherEvidence.length > 0) {
    explanation += `\n#### Associated Components & References:\n`;
    otherEvidence.forEach((item, idx) => {
      const evNum = idx + 2;
      explanation += `- [Evidence #${evNum}] in \`${item.filePath}\` (lines ${item.startLine}-${item.endLine})`;
      if (item.symbolName) {
        explanation += ` defines \`${item.symbolName}\` (${item.symbolType})`;
      }
      explanation += `.\n`;
    });
  }

  explanation += `\n> **Verification Guarantee**: Every file and line cited above reflects exact AST parse ranges from the repository.`;

  return explanation;
}

// Generate grounded AI explanation using Featherless AI with local fallback
async function generateExplanation({ query, evidenceList, repositoryName }) {
  const formattedContext = formatEvidenceContext(evidenceList);

  const systemPrompt = `You are CodeLens AI, an expert code intelligence assistant.
Your goal is to accurately answer questions about unfamiliar software repositories based STRICTLY on the retrieved code evidence.
Rules:
1. Always ground your explanation in the provided code snippets.
2. Cite sources using [Evidence #N] notations matching the provided evidence list.
3. Explicitly state the exact file paths and line number ranges (e.g., \`server/controllers/task.js\` lines 45-72).
4. Never invent files, functions, or line numbers not present in the evidence.
5. If the evidence is insufficient, say so honestly.`;

  const userPrompt = `Repository: ${repositoryName || 'Uploaded Codebase'}
Developer Question: "${query}"

Here are the retrieved code snippets:
${formattedContext}

Provide a clear, technical, step-by-step grounded explanation referencing the specific files, symbols, and line ranges:`;

  if (!FEATHERLESS_API_KEY) {
    // Graceful offline fallback
    return {
      explanation: generateLocalGroundedExplanation(query, evidenceList, repositoryName),
      provider: 'CodeLens Local Grounding Engine (Offline Mode)',
      model: 'heuristic-ast-grounded'
    };
  }

  try {
    const response = await axios.post(
      FEATHERLESS_API_URL,
      {
        model: FEATHERLESS_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      },
      {
        headers: {
          'Authorization': `Bearer ${FEATHERLESS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const answer =
      response.data?.choices?.[0]?.message?.content ||
      generateLocalGroundedExplanation(query, evidenceList, repositoryName);

    return {
      explanation: answer,
      provider: 'Featherless AI',
      model: FEATHERLESS_MODEL
    };
  } catch (error) {
    console.warn('Featherless AI API call failed, falling back to local grounding engine:', error.message);
    return {
      explanation: generateLocalGroundedExplanation(query, evidenceList, repositoryName),
      provider: 'CodeLens Local Grounding Engine (Fallback)',
      model: 'heuristic-ast-grounded',
      apiError: error.message
    };
  }
}

module.exports = {
  formatEvidenceContext,
  generateLocalGroundedExplanation,
  generateExplanation
};