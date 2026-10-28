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

let current = "intro";

function show(state) {
  current = state;
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

let session = 0; // bumped when the window closes, so a late answer is dropped

async function ask(text) {
  const asked = session;
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
  if (asked === session) showAnswer(result);
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

// The × closes the window to a desktop icon; the icon reopens it fresh, with
// a double-click like Win98, or a tap on touch screens. Enter and Space
// (click events with detail 0) open it too.
const dialog = $(".dialog");
const desktopIcon = $("#reopen");

$("#close").addEventListener("click", () => {
  session++;
  clearTrails();
  show("intro");
  project.value = "";
  count.textContent = "0";
  askError.hidden = true;
  dialog.hidden = true;
  desktopIcon.hidden = false;
  desktopIcon.focus();
});

function reopen() {
  desktopIcon.hidden = true;
  dialog.hidden = false;
  moveDialog(0, 0);
  $("[data-state=intro] button").focus();
}
desktopIcon.addEventListener("dblclick", reopen);
desktopIcon.addEventListener("click", (e) => {
  if (touchScreen.matches || e.detail === 0) reopen();
});

// On a computer the window can be dragged by its title bar, but never so far
// that the title bar leaves the screen.
const titlebar = $(".titlebar");
let offsetX = 0;
let offsetY = 0;

function moveDialog(x, y) {
  offsetX = x;
  offsetY = y;
  dialog.style.translate = x || y ? `${x}px ${y}px` : "";
}

// Win98 easter egg: a frozen program's window left copies of itself behind
// when dragged, because nothing redrew the screen. Always while the ball is
// thinking ("Not Responding"), and on the odd random drag. The copies are
// inert pictures; they go 30 s after the last drag, past 150, on a click on
// empty space, or when the window closes.
const main = $("main");
const TRAIL_MAX = 150;
const TRAIL_GAP = 8; // px between copies
const GLITCH_CHANCE = 0.1;
const trails = [];
let trailTimer;

function clearTrails() {
  clearTimeout(trailTimer);
  trails.splice(0).forEach((copy) => copy.remove());
}

function stampTrail() {
  const copy = dialog.cloneNode(true);
  // A picture, not a second window: no ids, states, roles or focus.
  [copy, ...copy.querySelectorAll("*")].forEach((el) => {
    el.removeAttribute("id");
    el.removeAttribute("role");
    el.removeAttribute("data-state");
  });
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.classList.add("trail");
  copy.style.left = `${dialog.offsetLeft}px`;
  copy.style.top = `${dialog.offsetTop}px`;
  copy.style.width = `${dialog.offsetWidth}px`;
  main.insertBefore(copy, dialog);
  const scroll = copy.querySelector(".scroll");
  if (scroll) scroll.scrollTop = $(".scroll").scrollTop;
  trails.push(copy);
  if (trails.length > TRAIL_MAX) trails.shift().remove();
}

document.addEventListener("click", (e) => {
  if (e.target === document.body || e.target === main) clearTrails();
});
addEventListener("resize", clearTrails);

titlebar.addEventListener("pointerdown", (e) => {
  if (touchScreen.matches || e.button !== 0 || e.target.closest("button")) return;
  e.preventDefault();
  clearTimeout(trailTimer);
  const smear = current === "loading" || Math.random() < GLITCH_CHANCE;
  if (current === "loading") $("#title").textContent = "thinking.exe (Not Responding)";
  let lastX = offsetX;
  let lastY = offsetY;
  const box = dialog.getBoundingClientRect();
  const homeLeft = box.left - offsetX;
  const homeTop = box.top - offsetY;
  const grabX = e.clientX - offsetX;
  const grabY = e.clientY - offsetY;
  const maxX = document.documentElement.clientWidth - box.width - homeLeft;
  const maxY = innerHeight - titlebar.offsetHeight - homeTop;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const drag = new AbortController();
  titlebar.setPointerCapture(e.pointerId);
  titlebar.addEventListener("pointermove", (m) => {
    if (smear && Math.hypot(offsetX - lastX, offsetY - lastY) >= TRAIL_GAP) {
      stampTrail();
      lastX = offsetX;
      lastY = offsetY;
    }
    moveDialog(clamp(m.clientX - grabX, -homeLeft, maxX), clamp(m.clientY - grabY, -homeTop, maxY));
  }, { signal: drag.signal });
  const stop = () => {
    drag.abort();
    if (trails.length) trailTimer = setTimeout(clearTrails, 30_000);
  };
  titlebar.addEventListener("pointerup", stop, { signal: drag.signal });
  titlebar.addEventListener("pointercancel", stop, { signal: drag.signal });
});

// iOS Safari only shows :active (the pressed button) when the page listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

show("intro");
