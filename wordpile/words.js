import { ACCEPTABLE_WORDS } from "./acceptable-words.js";
import { POSSIBLE_ANSWERS } from "./possible-answers.js";

const FIVE = /^[a-z]{5}$/;

// Two separate lists, by design:
//  - WORDS:   the big dictionary a player may *submit* (validation).
//  - ANSWERS: the curated list the daily puzzle is *built* from (and the list
//             we measure "how many solutions" against).
const WORDS = ACCEPTABLE_WORDS.filter((word) => FIVE.test(word));
const WORD_SET = new Set(WORDS);
const ANSWERS = POSSIBLE_ANSWERS.map((word) => word.toLowerCase()).filter((word) =>
	FIVE.test(word),
);

export function isValidWord(word) {
	return WORD_SET.has(word.toLowerCase());
}

// --- Seeded PRNG ------------------------------------------------------------
// Deterministic so a given seed (e.g. today's date) always builds the same puzzle.

function hashString(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Builds a seeded random function from any string key (e.g. a date).
export function makeRandom(key) {
	return mulberry32(hashString(String(key)));
}

// --- Letter signatures + answer index --------------------------------------

const A = 97; // "a"

function letterCounts(word) {
	const counts = new Int8Array(26);
	for (let i = 0; i < word.length; i++) counts[word.charCodeAt(i) - A]++;
	return counts;
}

// Each answer word carries a stable id (its index here) and a letter histogram.
const ANSWER_SIGS = ANSWERS.map((word, id) => ({ id, word, counts: letterCounts(word) }));

// answersByLetter[c] = answer words containing letter c, kept sorted by id.
// letterAnswerCount[c] = how many answer words contain letter c (lower = rarer).
const answersByLetter = Array.from({ length: 26 }, () => []);
const letterAnswerCount = new Array(26).fill(0);
for (const sig of ANSWER_SIGS) {
	for (let c = 0; c < 26; c++) {
		if (sig.counts[c] > 0) {
			answersByLetter[c].push(sig);
			letterAnswerCount[c]++;
		}
	}
}

// "Rare" letters are those few answer words use. With this list that's roughly
// j q z x v w k f b — the letters that actually constrain a pile.
const RARE_THRESHOLD = 270;
const RARE_LETTERS = [];
for (let c = 0; c < 26; c++) {
	if (letterAnswerCount[c] > 0 && letterAnswerCount[c] < RARE_THRESHOLD) RARE_LETTERS.push(c);
}

// --- Solution counter -------------------------------------------------------
// Counts, up to `limit`, the distinct ways a 25-letter pile can be split into
// `slots` answer words. "Distinct" = unordered set of words; permutations of the
// same set count once.
//
// Two tricks keep it fast and duplicate-free:
//  1. Anchor on the rarest letter still in the pool, and only try words that use
//     it. Rare letters have tiny candidate lists, so the search stays shallow.
//  2. While the same anchor letter is being consumed, require chosen words in
//     non-decreasing id order. That makes each unordered solution reachable by
//     exactly one path, so we never double-count permutations.

function fitsInPool(pool, counts) {
	for (let c = 0; c < 26; c++) {
		if (counts[c] > pool[c]) return false;
	}
	return true;
}

function rarestPresentLetter(pool) {
	let best = -1;
	let bestCount = Infinity;
	for (let c = 0; c < 26; c++) {
		if (pool[c] > 0 && letterAnswerCount[c] < bestCount) {
			bestCount = letterAnswerCount[c];
			best = c;
		}
	}
	return best;
}

function countSolutions(pool, slots, limit, budget) {
	let solutions = 0;
	let nodes = 0;
	let exhausted = false; // ran out of budget before finishing

	function withoutWord(pool, counts) {
		const next = pool.slice();
		for (let c = 0; c < 26; c++) next[c] -= counts[c];
		return next;
	}

	function fillAnchor(pool, slots, anchor, minId) {
		const candidates = answersByLetter[anchor];
		for (let k = 0; k < candidates.length; k++) {
			const sig = candidates[k];
			if (sig.id < minId) continue; // keep same-anchor words in id order
			if (!fitsInPool(pool, sig.counts)) continue;
			if (++nodes > budget) {
				exhausted = true;
				return;
			}
			const next = withoutWord(pool, sig.counts);
			if (next[anchor] > 0) {
				// Anchor letter still present: stay on it, words stay ordered.
				fillAnchor(next, slots - 1, anchor, sig.id);
			} else {
				fill(next, slots - 1);
			}
			if (solutions >= limit || exhausted) return;
		}
	}

	function fill(pool, slots) {
		if (slots === 0) {
			// Letters are conserved, so zero slots left means an empty pool.
			solutions++;
			return;
		}
		const anchor = rarestPresentLetter(pool);
		if (anchor < 0) return; // letters left but no word can use them
		fillAnchor(pool, slots, anchor, 0);
	}

	fill(pool, slots);
	return { solutions, exhausted };
}

// --- Daily puzzle generation ------------------------------------------------

// Tuning. The bias pushes a few rare letters onto every board so the pile stays
// well-constrained; acceptance then keeps only piles that have 1–3 rare letters
// and at most MAX_SOLUTIONS ways to solve.
const BIAS_POWER = 1.5;
const MAX_SOLUTIONS = 4;
const MIN_RARE_LETTERS = 1;
const MAX_RARE_LETTERS = 3;
const MAX_ATTEMPTS = 400;
const SOLVE_BUDGET = 500000;

// Sampling weight per answer word: rarer words (by their rarest letter) weigh
// more, so boards reliably pick up a rare letter or two.
const ANSWER_WEIGHTS = ANSWER_SIGS.map((sig) => {
	let rarest = Infinity;
	for (let c = 0; c < 26; c++) {
		if (sig.counts[c] > 0 && letterAnswerCount[c] < rarest) rarest = letterAnswerCount[c];
	}
	return 1 / Math.pow(rarest, BIAS_POWER);
});

// Weighted draw of `count` distinct answer words (without replacement).
function drawWords(count, random) {
	const available = ANSWER_SIGS.map((_, i) => i);
	const picked = [];

	for (let n = 0; n < count && available.length > 0; n++) {
		let total = 0;
		for (const i of available) total += ANSWER_WEIGHTS[i];

		let threshold = random() * total;
		let choicePos = available.length - 1;
		for (let p = 0; p < available.length; p++) {
			threshold -= ANSWER_WEIGHTS[available[p]];
			if (threshold <= 0) {
				choicePos = p;
				break;
			}
		}
		const [index] = available.splice(choicePos, 1);
		picked.push(ANSWER_SIGS[index]);
	}

	return picked;
}

function poolFromWords(sigs) {
	const pool = new Int8Array(26);
	for (const sig of sigs) {
		for (let c = 0; c < 26; c++) pool[c] += sig.counts[c];
	}
	return pool;
}

function distinctRareLetters(pool) {
	let n = 0;
	for (const c of RARE_LETTERS) {
		if (pool[c] > 0) n++;
	}
	return n;
}

// Picks the daily set of words. Returns { words, solutions }:
//  - words:     uppercase answer words that make up the pile
//  - solutions: how many distinct ways the pile can be solved (1..MAX_SOLUTIONS)
// Re-rolls (deterministically, from the same seeded stream) until a board has
// 1–3 rare letters and at most MAX_SOLUTIONS solutions.
export function pickWords(count, random = Math.random) {
	let fallback = null;

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const sigs = drawWords(count, random);
		const pool = poolFromWords(sigs);

		const rare = distinctRareLetters(pool);
		if (rare < MIN_RARE_LETTERS || rare > MAX_RARE_LETTERS) continue;

		const { solutions, exhausted } = countSolutions(pool, count, MAX_SOLUTIONS + 1, SOLVE_BUDGET);
		if (fallback === null && !exhausted) fallback = { sigs, solutions };
		if (exhausted) continue;

		if (solutions <= MAX_SOLUTIONS) {
			return { words: sigs.map((s) => s.word.toUpperCase()), solutions };
		}
	}

	// Couldn't satisfy the constraints in time — ship the first usable draw.
	const chosen = fallback ?? { sigs: drawWords(count, random), solutions: 0 };
	return {
		words: chosen.sigs.map((s) => s.word.toUpperCase()),
		solutions: chosen.solutions,
	};
}

export function scrambleLetters(words, random = Math.random) {
	const letters = words.join("").split("");

	for (let i = letters.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[letters[i], letters[j]] = [letters[j], letters[i]];
	}

	return letters;
}
