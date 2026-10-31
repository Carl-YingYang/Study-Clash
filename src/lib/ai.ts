
// STUDY CLASH — AI question generation (Groq, server-side only)
//
// Questions are generated strictly from extracted source material.
// Responses are validated before storage.
// Correct answers remain server-side and must never be exposed to clients.

import Groq from "groq-sdk";
import type { QuizDifficulty } from "./characters";

export interface GeneratedQuestion {
  text: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  sourceRef: string | null;
  difficulty: QuizDifficulty;
}

export interface GenerationOutcome {
  questions: GeneratedQuestion[];
  generatedCount: number;
  error?: string;
}

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const DIFFICULTY_BRIEF: Record<QuizDifficulty, string> = {
  EASY: `DIFFICULTY: EASY
- Ask about definitions, direct facts, basic identification and simple comprehension.
- Questions should be answerable directly from a single passage of the material.
- Wrong choices must be clearly incorrect to someone who read the material once.`,

  NORMAL: `DIFFICULTY: NORMAL
- Ask about understanding concepts, applying information to slightly new situations, and relationships between ideas.
- Require moderate reasoning: the answer follows from combining or interpreting parts of the material.
- Wrong choices should be plausible but definitively wrong based on the material.`,

  HARD: `DIFFICULTY: HARD
- Ask about comparisons, scenario-based application, multi-step reasoning and deeper interpretation of concepts.
- The correct answer must still be provable from the material, but require connecting several pieces of it.
- Wrong choices should be highly plausible common misconceptions of the material.`,
};

const SYSTEM_PROMPT = `You are an expert quiz writer for STUDY CLASH, a competitive study-quiz platform.

Your task is to write high-quality multiple-choice questions STRICTLY grounded in the provided SOURCE MATERIAL.

IMPORTANT RULES:

1. Every question, every choice, and the correct answer must be supported by the SOURCE MATERIAL. Never invent outside facts.
2. Exactly one choice must be correct and unambiguously correct.
3. Never write questions where multiple choices could reasonably be correct.
4. Never use "All of the above", "None of the above", or choices that reference other choices.
5. Keep question text under 220 characters.
6. Keep each answer choice under 110 characters.
7. Vary the position of the correct answer. Do not follow a predictable pattern.
8. The explanation must justify the correct answer in 1-3 sentences using the provided material.
9. sourceRef must be a short verbatim excerpt from the SOURCE MATERIAL that supports the correct answer. Keep it under 220 characters.
10. Do not create questions based on information that is merely implied but cannot reasonably be supported by the material.
11. If the SOURCE MATERIAL is too thin to write the requested number of reliable questions, return only the questions you can write reliably.
12. Do not repeat the same question using slightly different wording.

OUTPUT REQUIREMENTS:

Return a valid JSON object and NOTHING ELSE.

Use this exact structure:

{
  "questions": [
    {
      "question": "Question text",
      "choices": [
        "Choice A",
        "Choice B",
        "Choice C",
        "Choice D"
      ],
      "correctIndex": 0,
      "explanation": "Explanation based on the source material.",
      "sourceRef": "A verbatim excerpt from the source material."
    }
  ]
}

The correctIndex is zero-based:
0 = first choice
1 = second choice
2 = third choice
3 = fourth choice

Do not include markdown fences, commentary, or additional properties.`;

/**
 * Build the complete prompt for a single generation batch.
 */
function buildUserPrompt(
  sourceChunk: string,
  requested: number,
  difficulty: QuizDifficulty
): string {
  return `${SYSTEM_PROMPT}

${DIFFICULTY_BRIEF[difficulty]}

Generate up to ${requested} reliable multiple-choice questions about the SOURCE MATERIAL below.

Try to generate exactly ${requested} questions, but NEVER invent unsupported information just to reach the requested count.

Remember:
- Exactly four choices per question.
- Exactly one correct answer.
- Correct answer position should vary.
- Every question must be grounded in the supplied material.
- The sourceRef must be taken verbatim from the supplied material.

SOURCE MATERIAL:
<<<
${sourceChunk}
>>>`;
}

/**
 * Split text into paragraph-balanced chunks of roughly `size` characters.
 */
export function buildSourceChunks(
  text: string,
  size = 6000
): string[] {
  const paragraphs = text
    .split(/\n\n+/g)
    .filter((p) => p.trim().length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let len = 0;

  for (const paragraph of paragraphs) {
    current.push(paragraph);
    len += paragraph.length + 2;

    if (len >= size) {
      chunks.push(current.join("\n\n"));
      current = [];
      len = 0;
    }
  }

  if (current.length) {
    const tail = current.join("\n\n");

    if (chunks.length && tail.length < size / 4) {
      chunks[chunks.length - 1] += "\n\n" + tail;
    } else {
      chunks.push(tail);
    }
  }

  return chunks.length ? chunks : [text];
}

/**
 * Accept either:
 * - A direct JSON array.
 * - A JSON object containing a "questions" array.
 *
 * Groq JSON mode returns a JSON object, so the second format is preferred.
 */
function extractJsonArray(raw: string): unknown[] | null {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "questions" in parsed
    ) {
      const questions = (parsed as { questions?: unknown }).questions;

      if (Array.isArray(questions)) {
        return questions;
      }
    }
  } catch {
    // Try extracting the questions array from unexpected surrounding text.
  }

  const match = cleaned.match(/\[[\s\S]*\]/);

  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);

      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Validate and normalize one generated question.
 */
function normalizeQuestion(
  item: unknown,
  difficulty: QuizDifficulty
): GeneratedQuestion | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }

  const q = item as Record<string, unknown>;

  const text =
    typeof q.question === "string" ? q.question.trim() : "";

  if (text.length < 12 || text.length > 220) {
    return null;
  }

  if (!Array.isArray(q.choices) || q.choices.length !== 4) {
    return null;
  }

  const choices = q.choices.map((choice) =>
    typeof choice === "string" ? choice.trim() : ""
  );

  if (choices.some((choice) => choice.length < 1 || choice.length > 110)) {
    return null;
  }

  const lowerChoices = choices.map((choice) => choice.toLowerCase());

  // Reject duplicate choices.
  if (new Set(lowerChoices).size !== 4) {
    return null;
  }

  // Reject forbidden answer patterns.
  if (
    lowerChoices.some((choice) =>
      /all of the above|none of the above/.test(choice)
    )
  ) {
    return null;
  }

  const correctIndex = q.correctIndex;

  if (
    typeof correctIndex !== "number" ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex > 3
  ) {
    return null;
  }

  const explanation =
    typeof q.explanation === "string"
      ? q.explanation.trim().slice(0, 600)
      : "";

  const sourceRefRaw =
    typeof q.sourceRef === "string" ? q.sourceRef.trim() : "";

  const sourceRef =
    sourceRefRaw.length > 0
      ? sourceRefRaw.slice(0, 220)
      : null;

  return {
    text,
    choices,
    correctIndex,
    explanation,
    sourceRef,
    difficulty,
  };
}

// --------------------------------------------------
// GROQ CLIENT
// --------------------------------------------------

let groqClient: Groq | null = null;

/**
 * Create the Groq client lazily.
 *
 * GROQ_API_KEY must exist in the server-side .env file.
 * No API key is exposed to the browser.
 */
function getGroq(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing. Add your Groq API key to the root .env file."
    );
  }

  if (!groqClient) {
    groqClient = new Groq({
      apiKey,
    });
  }

  return groqClient;
}

/**
 * Generate a batch of questions using Groq.
 */
async function callLlm(
  groq: Groq,
  sourceChunk: string,
  requested: number,
  difficulty: QuizDifficulty
): Promise<GeneratedQuestion[]> {
  const model =
    process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;

  const completion = await groq.chat.completions.create({
    model,

    // Keep the instructions in the user message for compatibility
    // with GPT-OSS reasoning-model recommendations.
    messages: [
      {
        role: "user",
        content: buildUserPrompt(sourceChunk, requested, difficulty),
      },
    ],

    // Ask Groq to return valid JSON.
    response_format: {
      type: "json_object",
    },

    // Allow enough output for multiple questions and explanations.
    max_completion_tokens: 8192,
  });

  const content = completion.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    return [];
  }

  const questions = extractJsonArray(content);

  if (!questions) {
    console.error(
      "[Study Clash] Groq returned a response that could not be parsed as JSON."
    );

    return [];
  }

  return questions
    .map((item) => normalizeQuestion(item, difficulty))
    .filter(
      (question): question is GeneratedQuestion => question !== null
    );
}

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const status = (error as { status?: unknown }).status;

  return typeof status === "number" ? status : null;
}

function shouldRetry(error: unknown): boolean {
  const status = getErrorStatus(error);

  // Retry likely temporary network/API failures.
  // Do not retry invalid keys, invalid requests, or missing models.
  if (status === null) {
    return true;
  }

  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function getFriendlyGroqError(error: unknown): string {
  const status = getErrorStatus(error);

  if (status === 401 || status === 403) {
    return "Groq rejected the API key. Check your GROQ_API_KEY in the .env file.";
  }

  if (status === 404) {
    return "The configured Groq model was not found. Check your GROQ_MODEL value.";
  }

  if (status === 429) {
    return "Groq API rate limit reached. Please wait a moment and try again.";
  }

  if (status === 400) {
    return "Groq rejected the generation request. Check the selected model and request configuration.";
  }

  if (status !== null && status >= 500) {
    return "Groq is temporarily unavailable. Please try again later.";
  }

  return "The AI question generator failed to respond. Please try again.";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------
// MAIN QUESTION GENERATION
// --------------------------------------------------

/**
 * Generate `count` questions grounded in `sourceText`.
 *
 * Uses batches of up to 10 questions.
 * Requests spare questions per batch and removes duplicates.
 */
export async function generateQuestions(opts: {
  sourceText: string;
  count: number;
  difficulty: QuizDifficulty;
}): Promise<GenerationOutcome> {
  const { sourceText, count, difficulty } = opts;

  const trimmed = sourceText.trim();

  if (!Number.isInteger(count) || count < 1 || count > 30) {
    return {
      questions: [],
      generatedCount: 0,
      error: "The requested question count must be between 1 and 30.",
    };
  }

  if (trimmed.length < 600) {
    return {
      questions: [],
      generatedCount: 0,
      error:
        "This document doesn't contain enough extractable text to build a reliable quiz. Try a text-based PDF/DOCX/PPTX with more content.",
    };
  }

  // Initialize Groq only when question generation is requested.
  let groq: Groq;

  try {
    groq = getGroq();
  } catch (error) {
    console.error(
      "[Study Clash] Groq configuration error:",
      error instanceof Error ? error.message : error
    );

    return {
      questions: [],
      generatedCount: 0,
      error:
        error instanceof Error
          ? error.message
          : "Groq is not configured correctly.",
    };
  }

  const chunks = buildSourceChunks(trimmed, 6000);

  const batches = Math.ceil(count / 10);

  // Request spare questions so duplicates or invalid results
  // do not immediately prevent the requested count from being reached.
  const perBatch = Math.min(12, count + 2);

  const collected: GeneratedQuestion[] = [];
  const seen = new Set<string>();

  for (let batch = 0; batch < batches; batch++) {
    // Rotate through the source material so larger quizzes
    // cover different sections of the uploaded document.
    const chunk = chunks[batch % chunks.length];

    let questions: GeneratedQuestion[] = [];

    // Try once, then retry once for temporary API/network errors.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        questions = await callLlm(
          groq,
          chunk,
          perBatch,
          difficulty
        );

        break;
      } catch (error) {
        const status = getErrorStatus(error);

        console.error(
          `[Study Clash] Groq generation failed (batch ${batch + 1}, attempt ${attempt + 1}):`,
          {
            status,
            message:
              error instanceof Error ? error.message : "Unknown error",
          }
        );

        if (attempt === 0 && shouldRetry(error)) {
          await wait(1200);
          continue;
        }

        return {
          questions: collected,
          generatedCount: collected.length,
          error: getFriendlyGroqError(error),
        };
      }
    }

    // Remove duplicate questions before collecting results.
    for (const question of questions) {
      const key = question.text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      collected.push(question);

      if (collected.length >= count) {
        break;
      }
    }

    if (collected.length >= count) {
      break;
    }
  }

  if (collected.length < count) {
    return {
      questions: collected,
      generatedCount: collected.length,
      error: `The material only supported ${collected.length} reliable question${
        collected.length === 1 ? "" : "s"
      } at ${difficulty} difficulty. Reduce the question count or upload richer material.`,
    };
  }

  return {
    questions: collected.slice(0, count),
    generatedCount: count,
  };
}
