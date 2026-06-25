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

function buildWordIndex(words) {
	const sigs = words.map((word, id) => ({ id, word, counts: letterCounts(word) }));
	const byLetter = Array.from({ length: 26 }, () => []);
	const letterCount = new Array(26).fill(0);

	for (const sig of sigs) {
		for (let c = 0; c < 26; c++) {
			if (sig.counts[c] > 0) {
				byLetter[c].push(sig);
				letterCount[c]++;
			}
		}
	}

	return { sigs, byLetter, letterCount };
}

// Each indexed word carries a stable id (its index here) and a letter histogram.
const ANSWER_INDEX = buildWordIndex(ANSWERS);
const ACCEPTABLE_INDEX = buildWordIndex(WORDS);
const ANSWER_SIGS = ANSWER_INDEX.sigs;
const answersByLetter = ANSWER_INDEX.byLetter;
const letterAnswerCount = ANSWER_INDEX.letterCount;

// "Rare" letters are those few answer words use — the letters that actually
// constrain a pile. The threshold is relative to the answer-list size (here ~126
// words, since r/s/t/e are filtered out), so with this list rare = j q v z.
const RARE_THRESHOLD = 11;
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

function rarestPresentLetter(pool, letterCount) {
	let best = -1;
	let bestCount = Infinity;
	for (let c = 0; c < 26; c++) {
		if (pool[c] > 0 && letterCount[c] < bestCount) {
			bestCount = letterCount[c];
			best = c;
		}
	}
	return best;
}

export const countSolutions = (pool, slots, limit, budget, useAcceptableWords = false) => {
	const index = useAcceptableWords ? ACCEPTABLE_INDEX : ANSWER_INDEX;
	let solutions = 0;
	let nodes = 0;
	let exhausted = false; // ran out of budget before finishing

	function withoutWord(pool, counts) {
		const next = pool.slice();
		for (let c = 0; c < 26; c++) next[c] -= counts[c];
		return next;
	}

	function fillAnchor(pool, slots, anchor, minId) {
		const candidates = index.byLetter[anchor];
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
		const anchor = rarestPresentLetter(pool, index.letterCount);
		if (anchor < 0) return; // letters left but no word can use them
		fillAnchor(pool, slots, anchor, 0);
	}

	fill(pool, slots);
	return { solutions, exhausted };
}

// Counts how many distinct ways the pile (from `words`) can be solved using the
// full acceptable-word dictionary. Returns a plain number.
export function countAcceptableSolutions(words) {
	const pool = new Int8Array(26);
	for (const word of words) {
		const w = word.toLowerCase();
		for (let i = 0; i < w.length; i++) pool[w.charCodeAt(i) - A]++;
	}
	const { solutions } = countSolutions(pool, words.length, Infinity, SOLVE_BUDGET, true);
	return solutions;
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
const COUNT_SOLUTIONS_WITH_ACCEPTABLE_WORDS = false;

// Difficulty acceptance band (see scoreDifficulty). Boards outside [MIN, MAX] are
// re-rolled. The band was chosen from the observed distribution over many seeds
// (median ~69, bulk ~49–87): it drops trivially-easy and extreme-outlier piles
// while staying loose enough that the attempt loop reliably finds one.
const MIN_DIFFICULTY = 55;
const MAX_DIFFICULTY = 85;

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

// Picks the daily set of words. Returns { words, solutions, difficulty }:
//  - words:      uppercase answer words that make up the pile
//  - solutions:  how many distinct ways the pile can be solved (1..MAX_SOLUTIONS)
//  - difficulty: the scoreDifficulty value of the chosen pile
// Re-rolls (deterministically, from the same seeded stream) until a board has
// 1–3 rare letters, at most MAX_SOLUTIONS solutions, and a difficulty inside
// [MIN_DIFFICULTY, MAX_DIFFICULTY].
export function pickWords(count, random = Math.random) {
	const target = (MIN_DIFFICULTY + MAX_DIFFICULTY) / 2;
	let fallback = null; // best verified board so far, by closeness to the band centre

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const sigs = drawWords(count, random);
		const pool = poolFromWords(sigs);

		const rare = distinctRareLetters(pool);
		if (rare < MIN_RARE_LETTERS || rare > MAX_RARE_LETTERS) continue;

		const { solutions, exhausted } = countSolutions(
			pool,
			count,
			MAX_SOLUTIONS + 1,
			SOLVE_BUDGET,
			COUNT_SOLUTIONS_WITH_ACCEPTABLE_WORDS,
		);
		if (exhausted || solutions > MAX_SOLUTIONS) continue;

		const { difficulty } = poolDifficulty(pool, count);

		const dist = Math.abs(difficulty - target);
		if (fallback === null || dist < fallback.dist) {
			fallback = { sigs, solutions, difficulty, dist };
		}

		if (difficulty >= MIN_DIFFICULTY && difficulty <= MAX_DIFFICULTY) {
			return { words: sigs.map((s) => s.word.toUpperCase()), solutions, difficulty };
			console.log({ words: sigs.map((s) => s.word.toUpperCase()), solutions, difficulty });
		}
	}

	// Nothing landed in the band in time — ship the closest verified board (or, if
	// no board even passed the earlier gates, a last-resort raw draw).
	const chosen =
		fallback ??
		(() => {
			const sigs = drawWords(count, random);
			return {
				sigs,
				solutions: 0,
				difficulty: poolDifficulty(poolFromWords(sigs), count).difficulty,
			};
		})();
	return {
		words: chosen.sigs.map((s) => s.word.toUpperCase()),
		solutions: chosen.solutions,
		difficulty: chosen.difficulty,
	};
}

// --- Difficulty scoring -----------------------------------------------------
// Scores a finished board (its answer words) on a 0–100-ish scale. The board is
// treated purely as a 25-letter pile; "candidates" are the answer words from the
// possible-answers list that can be built from that pile.
//
// Formula (as specified):
//   difficulty =
//       30 * min(1, log2(C  + 1) / 7)
//     + 25 * min(1, log2(N4 + 1) / 6)
//     + 15 * min(1, log2(N3 + 1) / 8)
//     + 15 * min(1, O / 0.35)
//     + 10 * min(1, B / 0.25)
//     - 20 * max(0, S - 1)
//     - 10 * max(0, obviousRare - 1)
//
// C, S, N4, N3 are computed exactly. O, B and obviousRare were named but not
// fully defined; the definitions chosen here are documented at each helper and
// are easy to swap out.

const DIFF_BUDGET = 2_000_000; // node cap for the partition counters

// The log-terms saturate (min(...) hits 1) at these counts, so there's no point
// counting past them: log2(n+1)/k = 1  ->  n = 2^k - 1.
const N4_SAT = 63; //  2^6 - 1
const N3_SAT = 255; // 2^8 - 1
const S_CAP = 64; //   S is 1–3 by design; cap generously

const cap1 = (x) => Math.min(1, x);

// All answer words that can be assembled from the pile.
function candidatesInPool(pool) {
	return ANSWER_SIGS.filter((sig) => fitsInPool(pool, sig.counts));
}

// Counts distinct *unordered* sets of exactly `k` mutually-disjoint candidate
// words that fit in the pile. Candidates are visited in ascending id order and
// each step only looks forward, so every set is reached by exactly one path
// (no permutation double-counting). For a 25-letter pile every word is 5 letters,
// so a set of k words leaves 25 - 5k letters unused: k=5 -> S (0 left),
// k=4 -> N4 (5 left), k=3 -> N3 (10 left).
function countDisjointSets(pool, candidates, k, limit, budget) {
	let count = 0;
	let nodes = 0;
	let exhausted = false;

	function rec(remaining, start, depth) {
		if (depth === k) {
			count++;
			return;
		}
		for (let i = start; i < candidates.length; i++) {
			const sig = candidates[i];
			if (!fitsInPool(remaining, sig.counts)) continue;
			if (++nodes > budget) {
				exhausted = true;
				return;
			}
			const next = remaining.slice();
			for (let c = 0; c < 26; c++) next[c] -= sig.counts[c];
			rec(next, i + 1, depth + 1);
			if (count >= limit || exhausted) return;
		}
	}

	rec(pool, 0, 0);
	return { count, exhausted };
}

// O — average pairwise overlap between candidate words.
// Overlap of a pair = shared letters (with multiplicity) / 5, so it ranges 0..1.
// O is the mean of that over every unordered pair of candidates.
function averageOverlap(candidates) {
	const n = candidates.length;
	if (n < 2) return 0;
	let sum = 0;
	let pairs = 0;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			let shared = 0;
			const a = candidates[i].counts;
			const b = candidates[j].counts;
			for (let c = 0; c < 26; c++) shared += Math.min(a[c], b[c]);
			sum += shared / 5;
			pairs++;
		}
	}
	return sum / pairs;
}

// For each letter, how many candidate words use it at all.
function letterDemand(candidates) {
	const demand = new Array(26).fill(0);
	for (const sig of candidates) {
		for (let c = 0; c < 26; c++) {
			if (sig.counts[c] > 0) demand[c]++;
		}
	}
	return demand;
}

// B — bottleneck confusion score, in 0..1.
// A bottleneck is a rare letter where more candidate words want it (demand) than
// the pile has copies of it (supply): you must decide which word claims it.
// Per rare letter present: confusion = max(0, 1 - supply/demand) (0 when there's
// no contention). B is the average over the rare letters present in the pile.
function bottleneckConfusion(pool, demand) {
	let sum = 0;
	let n = 0;
	for (const c of RARE_LETTERS) {
		if (pool[c] <= 0) continue;
		n++;
		if (demand[c] > 0) sum += Math.max(0, 1 - pool[c] / demand[c]);
	}
	return n > 0 ? sum / n : 0;
}

// obviousRare — count of rare letters that give a word away: a rare letter
// present in the pile that exactly one candidate word uses, so its placement is
// forced (a "free" word). The formula only penalises the *second* onward.
function obviousRareCount(pool, demand) {
	let n = 0;
	for (const c of RARE_LETTERS) {
		if (pool[c] > 0 && demand[c] === 1) n++;
	}
	return n;
}

// Scores a 25-letter pile (Int8Array of 26 letter counts) split into `slots`
// words. Returns the difficulty plus the raw component values for inspection.
function poolDifficulty(pool, slots) {
	const candidates = candidatesInPool(pool);

	const C = candidates.length;
	const S = countDisjointSets(pool, candidates, slots, S_CAP, DIFF_BUDGET).count;
	const N4 = countDisjointSets(pool, candidates, slots - 1, N4_SAT + 1, DIFF_BUDGET).count;
	const N3 = countDisjointSets(pool, candidates, slots - 2, N3_SAT + 1, DIFF_BUDGET).count;

	const demand = letterDemand(candidates);
	const O = averageOverlap(candidates);
	const B = bottleneckConfusion(pool, demand);
	const obviousRare = obviousRareCount(pool, demand);

	const difficulty =
		30 * cap1(Math.log2(C + 1) / 7) +
		25 * cap1(Math.log2(N4 + 1) / 6) +
		15 * cap1(Math.log2(N3 + 1) / 8) +
		15 * cap1(O / 0.35) +
		10 * cap1(B / 0.25) -
		20 * Math.max(0, S - 1) -
		10 * Math.max(0, obviousRare - 1);

	return { difficulty, C, S, N4, N3, O, B, obviousRare };
}

// Scores a board (array of answer words) — convenience wrapper over poolDifficulty.
export function scoreDifficulty(words) {
	const pool = new Int8Array(26);
	for (const word of words) {
		const w = word.toLowerCase();
		for (let i = 0; i < w.length; i++) pool[w.charCodeAt(i) - A]++;
	}
	return poolDifficulty(pool, words.length);
}

// Enumerates every distinct way the pile (from `words`) can be split into answer
// words — i.e. all complete solutions. Each is an array of uppercase words;
// ascending-id ordering keeps each unordered solution unique. Capped at `limit`.
export function findSolutions(words, limit = 100) {
	const pool = new Int8Array(26);
	for (const word of words) {
		const w = word.toLowerCase();
		for (let i = 0; i < w.length; i++) pool[w.charCodeAt(i) - A]++;
	}
	const slots = words.length;
	const candidates = candidatesInPool(pool);
	const out = [];

	function rec(remaining, start, chosen) {
		if (chosen.length === slots) {
			out.push(chosen.map((s) => s.word.toUpperCase()));
			return;
		}
		for (let i = start; i < candidates.length && out.length < limit; i++) {
			const sig = candidates[i];
			if (!fitsInPool(remaining, sig.counts)) continue;
			const next = remaining.slice();
			for (let c = 0; c < 26; c++) next[c] -= sig.counts[c];
			rec(next, i + 1, [...chosen, sig]);
		}
	}

	rec(pool, 0, []);
	console.log(out);
	return out;
}

export function scrambleLetters(words, random = Math.random) {
	const letters = words.join("").split("");

	for (let i = letters.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[letters[i], letters[j]] = [letters[j], letters[i]];
	}

	return letters;
}
