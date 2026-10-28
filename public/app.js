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
const question = $("label[for=project]");
// Focusing the text box on a phone pops the keyboard up and jumps the page,
// so on touch screens focus goes to the question instead (screen readers
// still land in the right place) and the keyboard waits for a tap on the box.
// Checked on each screen change, like the CSS, in case a trackpad is attached.
const touchScreen = matchMedia("(pointer: coarse)");
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
    (touchScreen.matches ? question : project).focus();
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

// The drawn scrollbar on touch screens: CSS moves the thumb to match the text,
// this makes the arrows, track and thumb work like a real scrollbar.
const scroller = $(".scroll");
const bar = $(".fake-scrollbar");
const thumb = $(".thumb");
const STEP = 40;

bar.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const arrow = parseFloat(getComputedStyle(bar).getPropertyValue("--arrow"));
  const track = bar.getBoundingClientRect();
  const knob = thumb.getBoundingClientRect();
  const y = e.clientY;
  if (y < track.top + arrow) return scroller.scrollBy({ top: -STEP });
  if (y > track.bottom - arrow) return scroller.scrollBy({ top: STEP });
  if (y < knob.top) return scroller.scrollBy({ top: -scroller.clientHeight });
  if (y > knob.bottom) return scroller.scrollBy({ top: scroller.clientHeight });

  // Dragging the thumb: finger travel along the track maps to scroll distance.
  const travel = track.height - 2 * arrow - knob.height;
  const range = scroller.scrollHeight - scroller.clientHeight;
  const startTop = scroller.scrollTop;
  const drag = new AbortController();
  bar.setPointerCapture(e.pointerId);
  bar.addEventListener("pointermove", (m) => {
    scroller.scrollTop = startTop + ((m.clientY - y) * range) / travel;
  }, { signal: drag.signal });
  bar.addEventListener("pointerup", () => drag.abort(), { signal: drag.signal });
  bar.addEventListener("pointercancel", () => drag.abort(), { signal: drag.signal });
});

// iOS Safari only shows :active (the pressed button) when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

show("intro");
