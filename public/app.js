// State machine: intro -> (howItWorks) -> askProject -> loading -> answer.
// All server and user text is rendered with textContent, never innerHTML.

const MIN_SHAKE_MS = 1400; // let the shake read as a shake

const TITLES = {
  intro: "welcome.exe",
  howItWorks: "howitworks.txt",
  askProject: "ask.exe",
  loading: "thinking.exe",
  answer: "answer.txt",
};

const $ = (sel) => document.querySelector(sel);
const ball = $("#ball");
const ballText = $("#ball-text");
const answer = $("#answer");
const project = $("#project");
const count = $("#count");
const status = $("#status");
const loadingText = $("[data-state=loading] .q").textContent;

function setBall(glyph) {
  ballText.textContent = glyph;
}

function show(state) {
  document.querySelectorAll("[data-state]").forEach((el) => {
    el.hidden = el.dataset.state !== state;
  });
  $("#title").textContent = TITLES[state];
  ball.classList.toggle("shaking", state === "loading");

  if (state === "intro") setBall("8");
  if (state === "askProject") {
    setBall("?");
    project.focus();
  }
  if (state === "howItWorks") $(".scroll").focus();
  // Live regions inside [hidden] sections aren't announced, so the loading
  // message goes through an always-present status region and the answer is
  // read out by moving focus to it.
  status.textContent = state === "loading" ? loadingText : "";
  if (state === "answer") answer.focus();
}

function showAnswer(text) {
  setBall("!");
  answer.textContent = text;
  show("answer");
}

async function ask(text) {
  const started = Date.now();
  let result;
  try {
    const res = await fetch("/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: text }),
    });
    const data = await res.json();
    if (typeof data.answer !== "string") throw new Error("no answer");
    result = data.answer;
  } catch {
    result = "The spirits are unreachable. Check your connection and try again.";
  }
  const wait = MIN_SHAKE_MS - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  showAnswer(result);
}

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});

const askError = $("#ask-error");

project.addEventListener("input", () => {
  count.textContent = String(project.value.length);
  askError.hidden = true;
});

$("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = project.value.trim();
  if (!text) {
    askError.hidden = false;
    project.focus();
    return;
  }
  show("loading");
  ask(text);
});

show("intro");
