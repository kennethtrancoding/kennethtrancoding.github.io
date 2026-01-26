// Random question generator. Creates two dimensionally-matching unit expressions and
// a random magnitude, while avoiding awkward combinations (overlapping dims, offsets).
import { UNIT_DEFINITIONS, BASE_UNITS, ALL_UNIT_SYMBOLS, UNIT_ALIASES, PREFIXES } from "./units.js";
import { parseUnits, dimensionsEqual, convertValue, hasDimOverlapAcrossSides } from "./parse.js";

const resolveUnitKey = (symbol) => {
	const alias = UNIT_ALIASES.find(([alias]) => alias === symbol);
	return alias ? alias[1] : symbol;
};

const SIMPLE_DIM_KEYS = new Set(["Length", "Time", "Mass"]);
const SIMPLE_ALLOWED_CATEGORIES = new Set(["mechanical", "geometry", "time", "mass"]);
const CATEGORY_SIGNATURES = {
	electrical: ["ElectricCurrent"],
	photometry: ["LuminousIntensity"],
	chemistry: ["AmountOfSubstance"],
	temperature: ["Temperature"],
	radioactivity: ["Time"],
	radiation: [],
};

const getUnitCategory = (key) => UNIT_DEFINITIONS[key]?.category || "mechanical";
const isSimpleDimension = (dim) => Object.keys(dim).every((k) => SIMPLE_DIM_KEYS.has(k));
const hasSignatureForCategory = (dim, category) => {
	const sigs = CATEGORY_SIGNATURES[category];
	if (!sigs) return true;
	if (sigs.length === 0) return false;
	return sigs.every((k) => (dim[k] || 0) !== 0);
};

const pickRandom = (array) => array[Math.floor(Math.random() * array.length)];

function randomUnit(basePool = BASE_UNITS) {
	const base = pickRandom(basePool);
	const baseDef = UNIT_DEFINITIONS[base];
	const prefix = baseDef.allowPrefix ? pickRandom(PREFIXES) : "";
	const exponent = Math.floor(Math.random() * 5) - 2;
	const unitSymbol = `${prefix}${base}`;

	if (exponent <= 0) {
		return {
			unit: unitSymbol,
			exponent: Math.abs(exponent || 1),
			isDenominator: true,
			base,
		};
	}

	return { unit: unitSymbol, exponent, isDenominator: false, base };
}

function getAllowedUnitPool(targetDim) {
	if (targetDim && isSimpleDimension(targetDim)) {
		const pool = BASE_UNITS.filter(
			(key) =>
				SIMPLE_ALLOWED_CATEGORIES.has(getUnitCategory(key)) &&
				hasSignatureForCategory(targetDim, getUnitCategory(key)),
		);
		return pool.length ? pool : BASE_UNITS;
	}
	if (targetDim) {
		const pool = BASE_UNITS.filter((key) =>
			hasSignatureForCategory(targetDim, getUnitCategory(key)),
		);
		return pool.length ? pool : BASE_UNITS;
	}
	return BASE_UNITS;
}

function randomUnitExpression(targetDimensions = null) {
	const targetDim =
		targetDimensions && Object.keys(targetDimensions).length ? targetDimensions : null;
	const basePool = getAllowedUnitPool(targetDim);
	const targetSimple = targetDim ? isSimpleDimension(targetDim) : null;
	const maxAttempts = targetDim ? 200 : 20;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const termCount =
			(targetDim ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 3)) + 1;

		const numer = [];
		const denom = [];
		const usedUnits = new Set();
		const numerDims = new Set();
		const denomDims = new Set();
		const usedCategories = new Set();

		for (let i = 0; i < termCount; i++) {
			let choice = null;
			for (let tries = 0; tries < 10; tries++) {
				const candidate = randomUnit(basePool);
				const category = getUnitCategory(candidate.base);
				if (targetSimple === true && !SIMPLE_ALLOWED_CATEGORIES.has(category)) continue;
				const formatted =
					candidate.exponent === 1
						? candidate.unit
						: `${candidate.unit}^${candidate.exponent}`;
				if (usedUnits.has(formatted)) continue;

				const parsedCandidate = parseUnits(formatted);
				if (parsedCandidate.error) continue;

				const dimKeys = Object.keys(parsedCandidate.dim);
				const goesToDenom = candidate.isDenominator || Math.random() < 0.5;
				const conflicting = goesToDenom
					? dimKeys.some((k) => numerDims.has(k))
					: dimKeys.some((k) => denomDims.has(k));
				if (conflicting) continue;

				choice = {
					...candidate,
					formatted,
					goesToDenom,
					dimKeys,
					category,
				};
				usedUnits.add(formatted);
				break;
			}
			if (!choice) continue;
			const { formatted, goesToDenom, dimKeys } = choice;
			if (goesToDenom) {
				denom.push(formatted);
				dimKeys.forEach((k) => denomDims.add(k));
			} else {
				numer.push(formatted);
				dimKeys.forEach((k) => numerDims.add(k));
			}
			usedCategories.add(choice.category);
		}

		if (numer.length === 0) {
			const base = pickRandom(BASE_UNITS);
			const baseDef = UNIT_DEFINITIONS[base];
			const prefix = baseDef.allowPrefix ? pickRandom(PREFIXES) : "";
			numer.push(`${prefix}${base}`);
		}

		let expression = numer.join("*");
		if (denom.length > 0) expression += `/${denom.join("*")}`;

		const parsed = parseUnits(expression);
		const expressionIsSimple = !parsed.error && parsed.dim && isSimpleDimension(parsed.dim);
		const mustKeepSimple = targetSimple === null ? expressionIsSimple : targetSimple === true;
		const signaturesSatisfied =
			parsed.error || !parsed.dim
				? false
				: [...usedCategories].every((cat) =>
						cat in CATEGORY_SIGNATURES
							? hasSignatureForCategory(parsed.dim, cat)
							: true,
					);
		if (
			!parsed.error &&
			Object.keys(parsed.dim).length &&
			(!targetDim || dimensionsEqual(parsed.dim, targetDim)) &&
			!hasDimOverlapAcrossSides(expression) &&
			signaturesSatisfied &&
			(!mustKeepSimple || [...usedCategories].every((c) => SIMPLE_ALLOWED_CATEGORIES.has(c)))
		)
			return expression;
	}

	if (targetDim) {
		const matchingBase = BASE_UNITS.filter((unit) =>
			dimensionsEqual(UNIT_DEFINITIONS[unit].dim, targetDim),
		);
		if (matchingBase.length) return pickRandom(matchingBase);
		console.log("Failed to match requested dimensions, falling back to random unit.");
	} else {
		console.log("Failed to generate complex unit, falling back to simple unit.");
	}

	return pickRandom(BASE_UNITS);
}

function remapPrefixes(expression) {
	let changed = "";
	let lastIndex = 0;
	const regex = new RegExp(unitPattern(), "g");
	let match;
	while ((match = regex.exec(expression)) !== null) {
		changed += expression.slice(lastIndex, match.index);
		const [, , base, rawExponent = ""] = match;
		const unit = UNIT_DEFINITIONS[resolveUnitKey(base)];
		let newPrefix = "";
		if (unit.allowPrefix !== false) {
			do {
				newPrefix = pickRandom(PREFIXES);
			} while (newPrefix === match[1]);
		}
		changed += `${newPrefix}${base}${rawExponent}`;
		lastIndex = regex.lastIndex;
	}
	changed += expression.slice(lastIndex);
	return changed;
}

const unitPattern = () => {
	const prefixPattern = PREFIXES.filter(Boolean)
		.sort((a, b) => b.length - a.length)
		.join("|");
	return `(${prefixPattern}|)(${ALL_UNIT_SYMBOLS.join("|")})(\\^-?\\d+)?`;
};

const gcd = (a, b) => {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y) {
		[x, y] = [y, x % y];
	}
	return x || 1;
};

const randomAmount = () => {
	const mode = pickRandom(["number", "decimal", "fraction", "scientific"]);

	if (mode === "fraction") {
		const numerator = Math.floor(Math.random() * 19) + 2; // 2–20
		const denominator = Math.floor(Math.random() * 10) + 2; // 2–11
		const divisor = gcd(numerator, denominator);
		const n = numerator / divisor;
		const d = denominator / divisor;
		const value = n / d;
		if (!(n === d) && d !== 1) {
			return {
				value,
				plain: `${n}/${d}`,
				latex: `{${n}}/{${d}}`,
			};
		}
		mode = "number";
	}

	if (mode === "scientific") {
		const mantissa = +(Math.random() * 8 + 1).toFixed(2); // 1.00–9.00
		const exponent = pickRandom([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
		const value = mantissa * 10 ** exponent;
		return {
			value,
			plain: `${mantissa}e${exponent}`,
			latex: `${mantissa}\\times 10^{${exponent}}`,
		};
	}

	if (mode === "number") {
		const value = Math.floor(Math.random() * 998 + 1);
		return {
			value,
			plain: `${value}`,
			latex: `${value}`,
		};
	}

	// decimal
	const value = +(Math.random() * 900 + 10).toFixed(2);
	return {
		value,
		plain: `${value}`,
		latex: `${value}`,
	};
};

export function buildQuestion() {
	let fromUnit;
	let toUnit;
	let fromParsed;
	let toParsed;
	const ensureDifferentToUnit = (fromU, fromP, currentTo) => {
		const toP = parseUnits(currentTo);
		if (!toP.error && toP.normalized !== fromP.normalized) return currentTo;
		const fallback = randomUnitExpression(fromP.dim);
		const fallbackParsed = parseUnits(fallback);
		if (!fallbackParsed.error && fallbackParsed.normalized !== fromP.normalized)
			return fallback;
		return remapPrefixes(fromU);
	};

	for (let attempts = 0; attempts < 40; attempts++) {
		toUnit = null;
		toParsed = null;
		fromUnit = randomUnitExpression();
		fromParsed = parseUnits(fromUnit);
		if (
			fromParsed.error ||
			!Object.keys(fromParsed.dim).length ||
			hasDimOverlapAcrossSides(fromUnit)
		)
			continue;

		for (let inner = 0; inner < 40; inner++) {
			toUnit = randomUnitExpression();
			toParsed = parseUnits(toUnit);
			if (
				!toParsed.error &&
				dimensionsEqual(fromParsed.dim, toParsed.dim) &&
				toParsed.normalized !== fromParsed.normalized &&
				!hasDimOverlapAcrossSides(toUnit)
			)
				break;
		}
		if (
			toParsed &&
			!toParsed.error &&
			dimensionsEqual(fromParsed.dim, toParsed.dim) &&
			toParsed.normalized !== fromParsed.normalized &&
			!hasDimOverlapAcrossSides(toUnit)
		)
			break;
	}

	if (
		!toParsed ||
		toParsed.error ||
		!dimensionsEqual(fromParsed.dim, toParsed.dim) ||
		toParsed.normalized === fromParsed.normalized
	) {
		const base = pickRandom(BASE_UNITS);
		const baseDim = UNIT_DEFINITIONS[base].dim;
		const sameDimUnits = BASE_UNITS.filter((b) =>
			dimensionsEqual(UNIT_DEFINITIONS[b].dim, baseDim),
		);
		const altCandidates = sameDimUnits.filter((u) => u !== base);
		const alt = altCandidates.length ? pickRandom(altCandidates) : base;
		fromUnit = base;
		toUnit = alt;
		fromParsed = parseUnits(fromUnit);
		toParsed = parseUnits(toUnit);
	}

	toUnit = ensureDifferentToUnit(fromUnit, fromParsed, toUnit);
	if (fromUnit === toUnit && fromParsed?.dim) {
		for (let i = 0; i < 50 && fromUnit === toUnit; i++) {
			const candidate = randomUnitExpression(fromParsed.dim);
			const candidateParsed = parseUnits(candidate);
			if (
				!candidateParsed.error &&
				dimensionsEqual(candidateParsed.dim, fromParsed.dim) &&
				candidateParsed.normalized !== fromParsed.normalized
			) {
				toUnit = candidate;
			}
		}
		if (fromUnit === toUnit) {
			const remapped = remapPrefixes(fromUnit);
			if (remapped !== fromUnit) toUnit = remapped;
		}
	}

	const amount = randomAmount();
	return {
		amountValue: amount.value,
		amountDisplay: amount.plain,
		amountLatex: amount.latex,
		fromUnit,
		toUnit,
		expected: convertValue(amount.value, fromUnit, toUnit).value,
	};
}
