import {
	isValidWord,
	makeRandom,
	pickWords,
	scrambleLetters,
	countAcceptableSolutions,
	findSolutions,
} from "./words.js";

const WORD_COUNT = 5;
const WORD_LENGTH = 5;
const GRID_COLUMNS = 5;
const MAX_UNDOS = 10;

const grid = document.getElementById("letter-grid");
const rack = document.getElementById("word-rack");
const submitButton = document.getElementById("submit");
const clearButton = document.getElementById("clear");
const message = document.getElementById("message");
const foundList = document.getElementById("found-list");
const win = document.getElementById("win");
const puzzleLabel = document.getElementById("puzzle-label");

const statTime = document.getElementById("stat-time");
const statStreak = document.getElementById("stat-streak");
const statWinPct = document.getElementById("stat-winpct");
const statUndos = document.getElementById("stat-undos");

const key = dailyKey();
const random = makeRandom(key);
const { words, solutions } = pickWords(WORD_COUNT, random);
const solutionsAcceptableWords = countAcceptableSolutions(words);

window.findSolutions = (limit = 100) => findSolutions(words, limit);

// Local-date key: everyone playing on the same calendar day gets the same puzzle.
function dailyKey() {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

let letters = [];
let selectedIds = [];
let foundWords = [];
let nextLetterId = 0;
let nextWordId = 0;
let focusedLetterId = null;
let undosUsed = 0;
let lost = false;

function createLetters(chars) {
	return chars.map((letter) => ({
		id: nextLetterId++,
		letter,
		used: false,
	}));
}

function newGame() {
	// Seed from today's date so the puzzle is identical for every player today,
	// yet effectively random from one day to the next.

	letters = createLetters(scrambleLetters(words, random));
	selectedIds = [];
	foundWords = [];
	nextWordId = 0;
	focusedLetterId = null;
	undosUsed = 0;
	lost = false;

	// Restore today's in-progress (or finished) board, if any.
	restoreGame(key);

	setMessage("");
	render();

	recordPlay(key);
	startTimer(key);
	renderStats();

	// Already finished today: re-show the relevant end screen on reopen.
	if (foundWords.length === WORD_COUNT) showWinScreen();
	else if (lost) showLoseScreen();
}

function render() {
	const refocusId = document.activeElement?.classList?.contains("letter")
		? Number(document.activeElement.dataset.id)
		: null;

	renderRack();
	renderGrid();
	renderFoundWords();
	updateStatus();

	if (refocusId !== null) focusLetter(refocusId);

	saveGame();
}

function renderRack() {
	const selectedLetters = selectedIds.map((id) => getLetter(id)?.letter ?? "");
	rack.innerHTML = "";

	for (let i = 0; i < WORD_LENGTH; i++) {
		const slot = document.createElement("div");
		slot.className = selectedLetters[i] ? "slot filled" : "slot";
		slot.textContent = selectedLetters[i] || "·";
		rack.append(slot);
	}
}

function renderGrid() {
	grid.innerHTML = "";

	const tabStopId = rovingTabStopId();

	for (const item of letters) {
		const button = document.createElement("button");
		const selectedIndex = selectedIds.indexOf(item.id);
		button.className = ["letter", selectedIndex >= 0 ? "selected" : "", item.used ? "used" : ""]
			.filter(Boolean)
			.join(" ");
		button.type = "button";
		button.textContent = item.letter;
		button.dataset.id = String(item.id);
		button.disabled = item.used;
		// Roving tabindex: only one letter is a Tab stop; arrows move within the grid.
		button.tabIndex = item.id === tabStopId ? 0 : -1;
		button.setAttribute("aria-pressed", selectedIndex >= 0 ? "true" : "false");
		button.setAttribute(
			"aria-label",
			`${item.letter}${selectedIndex >= 0 ? `, selected ${selectedIndex + 1}` : ""}`,
		);

		const badge = document.createElement("span");
		badge.className = "badge";
		badge.textContent = selectedIndex >= 0 ? String(selectedIndex + 1) : "";
		button.append(badge);

		grid.append(button);
	}
}

function renderFoundWords() {
	foundList.innerHTML = "";

	// Once the pile is cleared (or the game is lost) the puzzle is locked: no
	// returning letters.
	const won = foundWords.length === WORD_COUNT;
	const locked = won || lost;

	for (const entry of foundWords) {
		const item = document.createElement("li");
		item.className = "found-item";

		const word = document.createElement("span");
		word.className = "found-word";
		word.textContent = entry.word;

		const button = document.createElement("button");
		button.className = "icon-btn";
		button.type = "button";
		button.dataset.id = String(entry.id);
		button.title = won ? "Pile cleared" : lost ? "Game over" : "Return letters";
		button.setAttribute("aria-label", `Return ${entry.word}`);
		button.textContent = "↺";
		button.disabled = locked;

		item.append(word, button);
		foundList.append(item);
	}
}

function updateStatus() {
	submitButton.disabled = selectedIds.length !== WORD_LENGTH || lost;
	win.classList.toggle("show", foundWords.length === WORD_COUNT);

	const undosLeft = MAX_UNDOS - undosUsed;
	if (statUndos) {
		statUndos.textContent = String(undosLeft);
		statUndos.classList.toggle("danger", undosLeft <= 3);
	}
}

function getLetter(id) {
	return letters.find((letter) => letter.id === id);
}

function availableLetters() {
	return letters.filter((item) => !item.used);
}

// Which letter holds the grid's single Tab stop (roving tabindex).
function rovingTabStopId() {
	const focused = getLetter(focusedLetterId);
	if (focused && !focused.used) return focusedLetterId;
	return availableLetters()[0]?.id ?? null;
}

function focusLetter(id) {
	const target = getLetter(id);
	const button = target && !target.used ? grid.querySelector(`.letter[data-id="${id}"]`) : null;
	if (button) {
		focusedLetterId = id;
		button.focus();
		return;
	}
	// Fall back to the first still-available letter (e.g. after it was used).
	const first = availableLetters()[0];
	if (first) {
		focusedLetterId = first.id;
		grid.querySelector(`.letter[data-id="${first.id}"]`)?.focus();
	}
}

// Move focus through the 2D grid from `id`, skipping used (hidden) letters.
function letterInDirection(id, key) {
	const index = letters.findIndex((item) => item.id === id);
	if (index < 0) return null;

	if (key === "Home") return availableLetters()[0]?.id ?? null;
	if (key === "End") {
		const open = availableLetters();
		return open[open.length - 1]?.id ?? null;
	}

	const steps = {
		ArrowLeft: -1,
		ArrowRight: 1,
		ArrowUp: -GRID_COLUMNS,
		ArrowDown: GRID_COLUMNS,
	};
	const step = steps[key];
	if (!step) return null;

	for (let i = index + step; i >= 0 && i < letters.length; i += step) {
		if (!letters[i].used) return letters[i].id;
	}
	return null;
}

function toggleLetter(id) {
	if (lost) return;
	const item = getLetter(id);
	if (!item || item.used) return;

	const selectedIndex = selectedIds.indexOf(id);
	if (selectedIndex >= 0) {
		selectedIds.splice(selectedIndex, 1);
		setMessage("");
		render();
		return;
	}

	if (selectedIds.length >= WORD_LENGTH) return;
	selectedIds.push(id);
	setMessage("");
	render();
}

function submitWord() {
	if (lost) return;
	if (selectedIds.length !== WORD_LENGTH) return;

	const word = selectedIds.map((id) => getLetter(id).letter).join("");
	if (!isValidWord(word)) {
		flashRack();
		setMessage("Not in word list", "bad");
		return;
	}

	for (const id of selectedIds) {
		getLetter(id).used = true;
	}

	foundWords.push({ id: nextWordId++, word, letterIds: [...selectedIds] });
	selectedIds = [];

	render();

	if (foundWords.length === WORD_COUNT) onWin();
}

function clearSelection() {
	if (lost) return;
	selectedIds = [];
	setMessage("");
	render();
}

function returnWord(id) {
	// The puzzle is locked once solved or lost.
	if (foundWords.length === WORD_COUNT || lost) return;

	const index = foundWords.findIndex((entry) => entry.id === id);
	if (index < 0) return;

	// Undos are a limited resource: you get MAX_UNDOS, and the next one ends the game.
	if (undosUsed >= MAX_UNDOS) {
		onLose();
		return;
	}
	undosUsed++;

	const [entry] = foundWords.splice(index, 1);
	for (const letterId of entry.letterIds) {
		const letter = getLetter(letterId);
		if (letter) letter.used = false;
	}
	selectedIds = [];

	const undosLeft = MAX_UNDOS - undosUsed;
	if (undosLeft === 0) {
		setMessage("No undos left—one more ends the game", "bad");
	} else {
		setMessage(`Letters returned · ${undosLeft} undo${undosLeft === 1 ? "" : "s"} left`);
	}
	render();
}

function selectKeyboardLetter(letter) {
	const match = letters.find((item) => {
		return !item.used && item.letter === letter && !selectedIds.includes(item.id);
	});
	if (match) toggleLetter(match.id);
}

function flashRack() {
	for (const slot of rack.children) {
		slot.classList.remove("bad");
		void slot.offsetWidth;
		slot.classList.add("bad");
	}
}

function setMessage(text, tone = "") {
	message.textContent = text;
	message.className = ["message", tone].filter(Boolean).join(" ");
}

grid.addEventListener("click", (event) => {
	const button = event.target.closest(".letter");
	if (!button) return;
	toggleLetter(Number(button.dataset.id));
});

grid.addEventListener("focusin", (event) => {
	const button = event.target.closest(".letter");
	if (button) focusedLetterId = Number(button.dataset.id);
});

const GRID_NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

grid.addEventListener("keydown", (event) => {
	const button = event.target.closest(".letter");
	if (!button || !GRID_NAV_KEYS.includes(event.key)) return;

	event.preventDefault();
	const nextId = letterInDirection(Number(button.dataset.id), event.key);
	if (nextId !== null) focusLetter(nextId);
});

foundList.addEventListener("click", (event) => {
	const button = event.target.closest(".icon-btn");
	if (!button) return;
	returnWord(Number(button.dataset.id));
});

submitButton.addEventListener("click", submitWord);
clearButton.addEventListener("click", clearSelection);

window.addEventListener("keydown", (event) => {
	if (
		event.target instanceof HTMLInputElement ||
		event.target instanceof HTMLTextAreaElement ||
		event.target instanceof HTMLSelectElement
	) {
		return;
	}

	// While the tutorial is open it owns the keyboard: Escape closes it, nothing else.
	if (tutorial?.classList.contains("show")) {
		if (event.key === "Escape") closeTutorial();
		return;
	}

	// The win screen likewise owns the keyboard while shown.
	if (winScreen?.classList.contains("show")) {
		if (event.key === "Escape") closeWinScreen();
		return;
	}

	// Same for the game-over screen.
	if (loseScreen?.classList.contains("show")) {
		if (event.key === "Escape") closeLoseScreen();
		return;
	}

	if (/^[a-z]$/i.test(event.key)) {
		selectKeyboardLetter(event.key.toUpperCase());
	} else if (event.key === "Backspace") {
		event.preventDefault();
		selectedIds.pop();
		setMessage("");
		render();
	} else if (event.key === "Escape") {
		clearSelection();
	} else if (event.key === "Enter") {
		// A focused letter handles Enter itself (toggles); don't also submit.
		if (event.target.closest?.(".letter")) return;
		submitWord();
	}
});

// --- Tutorial / how-to-play modal -------------------------------------------

const TUTORIAL_SEEN_KEY = "wordpile:tutorial-seen";
const tutorial = document.getElementById("tutorial");
const helpButton = document.getElementById("help");
const tutorialClose = document.getElementById("tutorial-close");
const tutorialPlay = document.getElementById("tutorial-play");

function openTutorial() {
	if (!tutorial) return;
	tutorial.classList.add("show");
	tutorial.setAttribute("aria-hidden", "false");
	tutorialPlay?.focus();
}

function closeTutorial() {
	if (!tutorial) return;
	tutorial.classList.remove("show");
	tutorial.setAttribute("aria-hidden", "true");
	try {
		localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
	} catch {
		// localStorage may be unavailable (private mode); modal still works per-session.
	}
}

helpButton?.addEventListener("click", openTutorial);
tutorialClose?.addEventListener("click", closeTutorial);
tutorialPlay?.addEventListener("click", closeTutorial);

tutorial?.addEventListener("click", (event) => {
	// Click on the dimmed backdrop (not the card) dismisses.
	if (event.target === tutorial) closeTutorial();
});

function maybeShowTutorialOnLoad() {
	let seen = false;
	try {
		seen = localStorage.getItem(TUTORIAL_SEEN_KEY) === "1";
	} catch {
		seen = false;
	}
	if (!seen) openTutorial();
}

// --- Timer, stats & win screen ----------------------------------------------

const STATS_KEY = "wordpile:stats";
const TIMER_KEY = "wordpile:timer";
const GAME_KEY = "wordpile:game";

const loseScreen = document.getElementById("losescreen");
const loseClose = document.getElementById("lose-close");
const loseDismiss = document.getElementById("lose-dismiss");
const loseFoundEl = document.getElementById("lose-found");
const loseTimeEl = document.getElementById("lose-time");

const winScreen = document.getElementById("winscreen");
const winClose = document.getElementById("win-close");
const winShare = document.getElementById("win-share");
const winTimeEl = document.getElementById("win-time");
const winStreakEl = document.getElementById("win-streak");
const winBestEl = document.getElementById("win-best");
const winPctEl = document.getElementById("win-winpct");
const winTimeUntilNew = document.getElementById("win-time-until-new");
const loseTimeUntilNew = document.getElementById("lose-time-until-new");
let countdownInterval = null;

function loadJSON(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}

function saveJSON(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// localStorage may be unavailable (private mode); stats stay per-session.
	}
}

// Persist the day's board so a refresh keeps your progress. The letter pile is
// regenerated deterministically from the date, so we only need to store which
// words were found and what's currently selected.
function saveGame() {
	saveJSON(GAME_KEY, {
		key: dailyKey(),
		foundWords,
		nextWordId,
		selectedIds,
		undosUsed,
		lost,
	});
}

function restoreGame(key) {
	const saved = loadJSON(GAME_KEY, null);
	if (!saved || saved.key !== key) return;

	foundWords = Array.isArray(saved.foundWords) ? saved.foundWords : [];
	nextWordId = Number.isInteger(saved.nextWordId) ? saved.nextWordId : foundWords.length;
	undosUsed = Number.isInteger(saved.undosUsed) ? saved.undosUsed : 0;
	lost = saved.lost === true;

	// Re-mark every letter consumed by a found word as used.
	for (const entry of foundWords) {
		for (const letterId of entry.letterIds ?? []) {
			const letter = getLetter(letterId);
			if (letter) letter.used = true;
		}
	}

	// Keep only still-selectable letters from the saved selection.
	const savedSelection = Array.isArray(saved.selectedIds) ? saved.selectedIds : [];
	selectedIds = savedSelection.filter((id) => {
		const letter = getLetter(id);
		return letter && !letter.used;
	});
}

let stats = loadJSON(STATS_KEY, {
	played: 0,
	won: 0,
	currentStreak: 0,
	maxStreak: 0,
	lastWonKey: null,
	lastPlayedKey: null,
});

let timer = loadJSON(TIMER_KEY, null);
let timerInterval = null;

// Local-date key for the day immediately before `key` (YYYY-MM-DD), used to
// decide whether a win extends the current streak or starts a new one.
function previousKey(key) {
	const [y, m, d] = key.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	date.setDate(date.getDate() - 1);
	const yy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${yy}-${mm}-${dd}`;
}

function formatTime(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

function elapsedMs() {
	if (!timer) return 0;
	return timer.wonElapsedMs != null ? timer.wonElapsedMs : Date.now() - timer.startTime;
}

function stopTimer() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
}

function tickTimer() {
	statTime.textContent = formatTime(elapsedMs());
}

// Start (or resume) today's clock. A fresh day resets it; reopening the same
// day continues from the persisted start, and a solved day stays frozen.
function startTimer(key) {
	stopTimer();
	if (!timer || timer.key !== key) {
		timer = { key, startTime: Date.now(), wonElapsedMs: null };
		saveJSON(TIMER_KEY, timer);
	}
	tickTimer();
	if (timer.wonElapsedMs == null) {
		timerInterval = setInterval(tickTimer, 1000);
	}
}

function winPct() {
	return stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
}

function renderStats() {
	statStreak.textContent = String(stats.currentStreak);
	statWinPct.textContent = `${winPct()}%`;
}

// Count one played game the first time today's puzzle is opened.
function recordPlay(key) {
	if (stats.lastPlayedKey === key) return;
	stats.played += 1;
	stats.lastPlayedKey = key;
	saveJSON(STATS_KEY, stats);
}

// Count a win once per day, extending the streak if yesterday was also solved.
function recordWin(key) {
	if (stats.lastWonKey === key) return;
	stats.won += 1;
	stats.currentStreak = stats.lastWonKey === previousKey(key) ? stats.currentStreak + 1 : 1;
	stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
	stats.lastWonKey = key;
	saveJSON(STATS_KEY, stats);
}

function onWin() {
	const key = dailyKey();

	// Freeze the clock at the winning time (persist so reloads stay frozen).
	if (timer && timer.wonElapsedMs == null) {
		timer.wonElapsedMs = Date.now() - timer.startTime;
		saveJSON(TIMER_KEY, timer);
	}
	stopTimer();
	statTime.textContent = formatTime(elapsedMs());

	recordWin(key);
	renderStats();
	showWinScreen();
}

function onLose() {
	lost = true;

	// Freeze the clock at the moment of the loss (persist so reloads stay frozen).
	if (timer && timer.wonElapsedMs == null) {
		timer.wonElapsedMs = Date.now() - timer.startTime;
		saveJSON(TIMER_KEY, timer);
	}
	stopTimer();
	statTime.textContent = formatTime(elapsedMs());

	// render() also persists the now-lost board via saveGame().
	render();
	showLoseScreen();
}

// Milliseconds until the next local midnight, when dailyKey() rolls over to a
// fresh puzzle.
function msUntilNextDay() {
	const now = new Date();
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
	return next - now;
}

function formatCountdown(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = String(Math.floor(total / 3600)).padStart(2, "0");
	const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
	const s = String(total % 60).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

function tickCountdown(win = true) {
	const timeUntilNew = win ? winTimeUntilNew : loseTimeUntilNew;
	if (!timeUntilNew) return;

	timeUntilNew.textContent = `Today's pile had ${solutions} solutions (and ${solutionsAcceptableWords - solutions} obscure ones). Come back in ${formatCountdown(msUntilNextDay())} for a new pile!`;
}

function showWinScreen() {
	if (!winScreen) return;

	winTimeEl.textContent = formatTime(elapsedMs());
	winStreakEl.textContent = String(stats.currentStreak);
	winBestEl.textContent = String(stats.maxStreak);
	winPctEl.textContent = `${winPct()}%`;

	tickCountdown();
	clearInterval(countdownInterval);
	countdownInterval = setInterval(tickCountdown, 1000);

	winScreen.classList.add("show");
	winScreen.setAttribute("aria-hidden", "false");
	winShare?.focus();
}

function closeWinScreen() {
	if (!winScreen) return;
	clearInterval(countdownInterval);
	countdownInterval = null;
	winScreen.classList.remove("show");
	winScreen.setAttribute("aria-hidden", "true");
}

function showLoseScreen() {
	if (!loseScreen) return;

	loseFoundEl.textContent = `${foundWords.length}/${WORD_COUNT}`;
	loseTimeEl.textContent = formatTime(elapsedMs());

	tickCountdown(false);
	clearInterval(countdownInterval);
	countdownInterval = setInterval(() => tickCountdown(false), 1000);

	loseScreen.classList.add("show");
	loseScreen.setAttribute("aria-hidden", "false");
	loseDismiss?.focus();
}

function closeLoseScreen() {
	if (!loseScreen) return;
	clearInterval(countdownInterval);
	countdownInterval = null;
	loseScreen.classList.remove("show");
	loseScreen.setAttribute("aria-hidden", "true");
}

function shareResult() {
	const key = dailyKey();
	const text =
		`Wordpile ${key}\n` +
		`⏱ ${formatTime(elapsedMs())}  ·  🔥 ${stats.currentStreak} streak  ·  ${winPct()}% wins\n` +
		`https://kennethtrancoding.com`;

	if (navigator.share) {
		navigator.share({ text }).catch(() => {});
		return;
	}
	if (navigator.clipboard?.writeText) {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				if (!winShare) return;
				winShare.textContent = "Copied!";
				setTimeout(() => {
					winShare.textContent = "Share result";
				}, 1500);
			})
			.catch(() => {});
	}
}

winClose?.addEventListener("click", closeWinScreen);
winShare?.addEventListener("click", shareResult);
winScreen?.addEventListener("click", (event) => {
	// Click on the dimmed backdrop (not the card) dismisses.
	if (event.target === winScreen) closeWinScreen();
});

loseClose?.addEventListener("click", closeLoseScreen);
loseDismiss?.addEventListener("click", closeLoseScreen);
loseScreen?.addEventListener("click", (event) => {
	// Click on the dimmed backdrop (not the card) dismisses.
	if (event.target === loseScreen) closeLoseScreen();
});

newGame();
maybeShowTutorialOnLoad();
