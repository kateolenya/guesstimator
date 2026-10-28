import {
  CLOUDY, HAZY, JOKES, JOKE_CHANCE, STYLES, JUDGE_MODEL, MAX_OUTPUT_TOKENS, MODEL, SLOW_DOWN, TIRED,
  buildJudgeMessages, buildMessages, cleanAnswer, cryptoRandom, isHazy, isQuotaError, judgeApproves,
  looksLikeEstimate, pick, validateProject,
} from "./oracle";

// Only the bindings we use, so we don't need extra type packages.
export interface Env {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  ASSETS: { fetch(req: Request): Promise<Response> };
}

const MAX_BODY_BYTES = 4096;

function reply(status: number, answer: string, kind: string): Response {
  return new Response(JSON.stringify({ answer, kind }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Reads the body as text, or returns null once it passes max bytes, without buffering the rest. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** Browsers send Origin on POST. Missing (curl, scripts) is allowed: this is CSRF protection, not access control. */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true; // includes "null" from sandboxed iframes and file:// pages
  }
}

export async function handleEstimate(
  request: Request,
  env: Env,
  random: () => number = cryptoRandom,
): Promise<Response> {
  try {
    return await estimate(request, env, random);
  } catch (err) {
    console.error("Unhandled error", err);
    return reply(500, CLOUDY, "error");
  }
}

async function estimate(request: Request, env: Env, random: () => number): Promise<Response> {
  if (request.method !== "POST") return reply(405, "The ball only answers POST.", "error");

  if (isCrossSite(request)) return reply(403, "This ball answers only its own page.", "error");

  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") return reply(415, "Send JSON, mortal.", "error");

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return reply(429, SLOW_DOWN, "error");

  const tooBig = reply(413, "That is a lot of project. Shorten it.", "error");
  // Refuse early when the size is declared; the header can be absent or wrong, so also stop reading at the cap.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooBig;
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return tooBig;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, "The ball could not read that.", "error");
  }

  const checked = validateProject(body);
  if ("error" in checked) return reply(400, checked.error, "error");

  // Randomness lives in code, not in the model.
  if (random() < JOKE_CHANCE) return reply(200, pick(JOKES, random()), "joke");

  let answer: string;
  try {
    const output = await env.AI.run(MODEL, {
      messages: buildMessages(checked.project, pick(STYLES, random())),
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.8,
      // Gemma thinks before answering by default and would spend the whole token budget on it.
      chat_template_kwargs: { enable_thinking: false },
    });
    answer = cleanAnswer(output);
  } catch (err) {
    console.error("AI error", err);
    return isQuotaError(err) ? reply(503, TIRED, "error") : reply(502, CLOUDY, "error");
  }
  if (answer === CLOUDY) return reply(502, CLOUDY, "error");

  // Blocked or failed answers look like the ordinary joke roll, so attackers can't tell they were caught.
  if (isHazy(answer)) return reply(200, pick(HAZY, random()), "joke");
  if (!looksLikeEstimate(answer)) return reply(200, pick(JOKES, random()), "joke");
  try {
    const verdict = await env.AI.run(JUDGE_MODEL, { messages: buildJudgeMessages(answer), max_tokens: 2, temperature: 0 });
    if (judgeApproves(verdict)) return reply(200, answer, "estimate");
    console.warn("Judge rejected", answer);
  } catch (err) {
    console.error("Judge error", err);
    if (isQuotaError(err)) return reply(503, TIRED, "error");
  }
  return reply(200, pick(JOKES, random()), "joke");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/estimate") return handleEstimate(request, env);
    if (pathname.startsWith("/api/")) return reply(404, "No such spell.", "error");
    return env.ASSETS.fetch(request);
  },
};
