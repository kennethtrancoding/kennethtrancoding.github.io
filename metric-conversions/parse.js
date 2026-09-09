// Parser and evaluator for unit expressions entered in the drill. Converts MathQuill
// LaTeX into tokens, validates dimensional consistency, and computes conversions.
import {
	NAMED_UNITS,
	ALL_UNIT_SYMBOLS,
	UNIT_ALIASES,
	PREFIXES,
	PREFIX_MULTIPLIERS,
} from "./units.js";

const resolveUnitKey = (symbol) => {
	const alias = UNIT_ALIASES.find(([alias]) => alias === symbol);
	return alias ? alias[1] : symbol;
};
const sortedPrefixes = PREFIXES.filter(Boolean).sort((a, b) => b.length - a.length);
const sortedUnits = ALL_UNIT_SYMBOLS.slice().sort((a, b) => b.length - a.length);
export const getUnitDefinition = (symbol) => NAMED_UNITS[resolveUnitKey(symbol)];

const normalizeMicro = (expression) => {
	// Let users type "um" for micrometers, but leave a bare "u" alone when it is
	// not clearly a metric prefix attached to a known prefixable unit.
	let out = "";
	let i = 0;
	const len = expression.length;
	while (i < len) {
		const ch = expression[i];
		const prev = i === 0 ? "" : expression[i - 1];
		const canBePrefix = i === 0 || /[^A-Za-z0-9]/.test(prev);

		if (ch === "u" && canBePrefix) {
			const rest = expression.slice(i + 1);
			const prefixedBase = sortedUnits.find((sym) => {
				if (!rest.startsWith(sym)) return false;
				const def = getUnitDefinition(sym);
				return def?.allowPrefix !== false;
			});
			if (prefixedBase) {
				out += "µ";
				i++;
				continue;
			}
		}

		out += ch;
		i++;
	}
	return out;
};

function expandFractions(expr) {
	// Replace LaTeX \frac{a}{b} with (a)/(b) so the rest of the parser can stay simple.
	let i = 0;
	const len = expr.length;
	let out = "";

	const wrapArg = (content) => {
		const trimmed = content.trim();
		if (!trimmed) return "()";
		const startsParens = trimmed.startsWith("(") && trimmed.endsWith(")");
		if (startsParens) {
			let depth = 0;
			for (let idx = 0; idx < trimmed.length; idx++) {
				const ch = trimmed[idx];
				if (ch === "(") depth++;
				else if (ch === ")") depth--;
				if (depth === 0 && idx < trimmed.length - 1) return `(${trimmed})`;
			}
			return trimmed;
		}
		if (/[+\-*/^]/.test(trimmed)) return `(${trimmed})`;
		return trimmed;
	};

	const skipSpaces = () => {
		while (i < len && /\s/.test(expr[i])) i++;
	};

	const extractBraced = () => {
		if (expr[i] !== "{") return null;
		let depth = 0;
		const start = i + 1;
		for (; i < len; i++) {
			if (expr[i] === "{") depth++;
			else if (expr[i] === "}") {
				depth--;
				if (depth === 0) {
					const content = expr.slice(start, i);
					i++;
					return content;
				}
			}
		}
		return null;
	};

	while (i < len) {
		if (expr.startsWith("\\frac", i)) {
			i += 5;
			skipSpaces();
			const numer = extractBraced();
			if (numer === null) {
				out += "\\frac";
				continue;
			}
			skipSpaces();
			const denom = extractBraced();
			if (denom === null) {
				out += `\\frac{${numer}`;
				continue;
			}
			// Brace contents are lifted out verbatim, so expand them too. Without this
			// a \frac nested inside another \frac is never rewritten and survives into
			// the tokenizer as the literal text "frac".
			const wrappedNumer = wrapArg(expandFractions(numer));
			const wrappedDenom = wrapArg(expandFractions(denom));
			const bothEmpty = wrappedNumer === "()" && wrappedDenom === "()";
			const numerEmpty = wrappedNumer === "()";
			const denomEmpty = wrappedDenom === "()";
			if (bothEmpty) out += `(${wrappedNumer})/(${wrappedDenom})`;
			else if (denomEmpty) out += `(${wrappedNumer})/${wrappedDenom}`;
			else if (numerEmpty) out += `${wrappedNumer}/(${wrappedDenom})`;
			else out += `(${wrappedNumer})/(${wrappedDenom})`;
			continue;
		}
		out += expr[i++];
	}
	return out;
}

const SUPERSCRIPT_DIGITS = {
	"⁰": "0",
	"¹": "1",
	"²": "2",
	"³": "3",
	"⁴": "4",
	"⁵": "5",
	"⁶": "6",
	"⁷": "7",
	"⁸": "8",
	"⁹": "9",
	"⁻": "-",
};

const normalizeSymbols = (expression) =>
	String(expression ?? "")
		// MathQuill writes the micro sign as \mu. Stripping the backslash later would
		// leave "mu", which the tokenizer then reads as milli + u (dalton) rather than
		// micro, so a typed "µm" would silently become a mass unit.
		.replace(/\\mu(?![A-Za-z])/g, "µ")
		.replace(/μ/g, "µ")
		// This grammar spells ohm out, so accept the symbol and macro users reach for
		// instead of failing on the leftover text "Omega".
		.replace(/\\Omega(?![A-Za-z])|\\omega(?![A-Za-z])|[ΩΩ]/g, "ohm")
		.replace(/×/g, "*")
		.replace(/÷/g, "/")
		.replace(/[−–—]/g, "-")
		// A typed superscript such as m² means the same as m^2.
		.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) =>
			`^${[...run].map((ch) => SUPERSCRIPT_DIGITS[ch]).join("")}`,
		);

export function cleanExpression(expression) {
	// Convert MathQuill/LaTeX-ish input into the compact grammar consumed by the
	// tokenizer: plain operators, parenthesis groups, and ^integer exponents.
	const fractionNormalized = expandFractions(normalizeSymbols(expression));
	const output = normalizeMicro(fractionNormalized.trim())
		.replace(/\\+left|\\+right/g, "")
		.replace(/\\+times/g, "*")
		.replace(/\\+cdot/g, "*")
		.replace(/\u00b7/g, "*")
		// A LaTeX thin space separates adjacent unit symbols, so it means
		// multiplication. Dropping it would silently glue the symbols together and
		// reinterpret them as one prefixed unit ("m\,s" becoming "ms", millisecond).
		.replace(/\\+,/g, "*")
		.replace(/\\+ /g, "*")
		.replace(/\*+/g, "*")
		.replace(/\s+/g, "")
		.replace(/\\operatorname\{([^}]+)\}/g, "$1")
		.replace(/\^\{(-?\d+)\}/g, "^$1")
		.replace(/{/g, "(")
		.replace(/}/g, ")")
		.replace(/\\/g, "")
		// Spacing macros are cosmetic, so a stray one at an edge or next to another
		// operator must not turn a partially-typed expression into a syntax error.
		.replace(/^\*+|\*+$/g, "")
		.replace(/\*+([/)])/g, "$1")
		.replace(/([(/])\*+/g, "$1");
	return output;
}

export function dimensionsEqual(dimensionA, dimensionB) {
	// Dimension objects only store non-zero exponents, so missing keys count as 0.
	const keys = new Set([...Object.keys(dimensionA), ...Object.keys(dimensionB)]);
	for (const key of keys) if ((dimensionA[key] || 0) !== (dimensionB[key] || 0)) return false;
	return true;
}

const prefixPattern = PREFIXES.filter(Boolean)
	.sort((a, b) => b.length - a.length)
	.join("|");
const unitPattern = `(${prefixPattern}|)(${ALL_UNIT_SYMBOLS.join("|")})(\\^-?\\d+)?`;
const exponentRegex = /^\^-?\d+/;

const matchUnitAt = (text, startIndex) => {
	// Prefer the longest legal unit/prefix match. This prevents "min" from being
	// read as "m" plus leftover "in", and "dam" from becoming "d" + "am".
	let best = null;

	for (const base of sortedUnits) {
		if (!text.startsWith(base, startIndex)) continue;
		best = { prefix: "", base, def: getUnitDefinition(base), length: base.length };
		break;
	}

	for (const prefix of sortedPrefixes) {
		if (!text.startsWith(prefix, startIndex)) continue;
		const afterPrefix = startIndex + prefix.length;
		for (const base of sortedUnits) {
			if (!text.startsWith(base, afterPrefix)) continue;
			const def = getUnitDefinition(base);
			if (def?.allowPrefix === false) continue;
			const totalLength = prefix.length + base.length;
			if (!best || totalLength > best.length)
				best = { prefix, base, def, length: totalLength };
			break;
		}
	}

	return best;
};

export const scanUnitToken = (text, startIndex) => {
	// A unit token is a prefixable symbol plus an optional integer exponent.
	const unitMatch = matchUnitAt(text, startIndex);
	if (!unitMatch) return null;
	const exponentMatch = exponentRegex.exec(text.slice(startIndex + unitMatch.length));
	const rawExponent = exponentMatch ? exponentMatch[0] : "";
	const consumed = unitMatch.length + rawExponent.length;
	return { ...unitMatch, rawExponent, consumed };
};

// Question generation runs the same short unit strings through these pure
// string -> result functions thousands of times per question, so routing every
// check through one pipeline also gives one place worth memoizing. Every caller
// treats the results as read-only.
const CACHE_LIMIT = 2000;
const memoizeByString = (compute) => {
	const cache = new Map();
	return (input) => {
		if (typeof input !== "string") return compute(input);
		if (cache.has(input)) return cache.get(input);
		const result = compute(input);
		if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
		cache.set(input, result);
		return result;
	};
};

// The single syntax pipeline. Every check in the app - live preview, answer
// grading, target-unit validation, question generation and display text - runs
// input through this one function, so they cannot drift apart or disagree about
// whether something is valid. Stages are cumulative and the result carries
// whatever was reached before a failure, which lets display code fall back to
// tokens when the full parse did not succeed.
export const analyzeExpression = memoizeByString((expression) => computeAnalysis(expression));

function computeAnalysis(expression) {
	try {
		const cleaned = cleanExpression(expression);
		if (!cleaned) return { cleaned: "", stage: "empty", error: "Enter a value and units." };

		const tokenized = tokenize(cleaned);
		if (tokenized.error) return { cleaned, stage: "tokenize", error: tokenized.error };
		const { tokens } = tokenized;

		const parsed = parseExpression(tokenized);
		if (parsed.error) return { cleaned, tokens, stage: "parse", error: parsed.error };
		const { ast } = parsed;

		const evaluated = evaluateAst(ast);
		if (evaluated.error)
			return { cleaned, tokens, ast, stage: "evaluate", error: evaluated.error };

		return { cleaned, tokens, ast, value: evaluated.value, unit: evaluated.unit };
	} catch (e) {
		console.error("Failed to analyze expression:", e);
		return { cleaned: "", stage: "exception", error: "Could not read that expression." };
	}
}

const literalExponent = (node) => {
	// Exponents must be plain integers, so unwrap grouping and unary signs rather
	// than evaluating arbitrary sub-expressions.
	let current = node;
	while (current?.type === "group") current = current.value;
	if (current?.type === "number") return current.value;
	if (current?.type === "unary") {
		const inner = literalExponent(current.value);
		if (inner === null) return null;
		return current.op === "-" ? -inner : inner;
	}
	return null;
};

// Flatten an AST into its unit terms, each carrying a net exponent that already
// accounts for nesting, division and powers. This is the one place that decides
// what "the units of this expression" are, so canonical naming, dimension
// overlap checks and hint lookups all reach the same answer.
export function collectUnitTerms(node, exponent = 1, out = []) {
	if (!node) return out;
	switch (node.type) {
		case "group":
		case "unary":
			return collectUnitTerms(node.value, exponent, out);
		case "binary":
			if (node.op === "*" || node.op === "/") {
				collectUnitTerms(node.left, exponent, out);
				collectUnitTerms(node.right, node.op === "/" ? -exponent : exponent, out);
			}
			return out;
		case "power": {
			const power = literalExponent(node.exponent);
			return power === null ? out : collectUnitTerms(node.base, exponent * power, out);
		}
		case "unit": {
			const token = scanUnitToken(node.symbol, 0);
			if (!token) return out;
			const own = token.rawExponent ? parseInt(token.rawExponent.slice(1), 10) : 1;
			out.push({
				key: resolveUnitKey(token.base),
				prefix: token.prefix,
				exponent: own * exponent,
			});
			return out;
		}
		default:
			return out;
	}
}

// Merge repeated symbols and keep first-appearance order, which display code
// wants. Terms that cancel out entirely are dropped.
export function mergeUnitTerms(terms) {
	const merged = new Map();
	for (const term of terms) {
		const symbol = `${term.prefix}${term.key}`;
		const existing = merged.get(symbol);
		if (existing) existing.exponent += term.exponent;
		else merged.set(symbol, { ...term, symbol });
	}
	return [...merged.values()].filter((term) => term.exponent !== 0);
}

// Canonical text for a unit expression: alias-resolved, exponents merged, and
// sorted so the same unit written two ways ("m*s" and "s*m") yields one string.
// Question generation compares these to guarantee source and target really differ.
function canonicalUnitName(terms) {
	return mergeUnitTerms(terms)
		.map((term) => ({ symbol: term.symbol, exponent: term.exponent }))
		.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
		.map(({ symbol, exponent }) => (exponent === 1 ? symbol : `${symbol}^${exponent}`))
		.join("*");
}

export const parseUnits = memoizeByString((expression) => {
	// A unit expression is just an expression whose numeric part is exactly 1 and
	// whose units are non-empty. Expressing it that way lets it share the grammar
	// used for answers instead of applying a second, subtly different one. The
	// previous hand-rolled splitter treated everything after the first "/" as a
	// denominator, so it read "kg/m*s" as kg/(m*s) while the answer parser read the
	// same text as (kg/m)*s.
	const analyzed = analyzeExpression(expression);
	if (analyzed.error) return { error: analyzed.error };

	const { value, unit, ast } = analyzed;
	if (!Object.keys(unit.dim).length) return { error: "Units are required (e.g., m, kg, s)." };
	if (!Number.isFinite(value) || Math.abs(value - 1) > 1e-12)
		return { error: "A unit on its own cannot include a numeric factor." };

	const terms = collectUnitTerms(ast);
	return {
		factor: unit.factor,
		dim: { ...unit.dim },
		normalized: canonicalUnitName(terms),
		hasOffset: unit.hasOffset,
		offset: unit.offset,
		bases: [...new Set(terms.map((term) => term.key))],
	};
});
export function convertValue(value, fromUnit, toUnitExpression) {
	const fromParsed = typeof fromUnit === "string" ? parseUnits(fromUnit) : fromUnit;
	if (!fromParsed || fromParsed.error)
		return { error: fromParsed?.error || "Invalid source unit." };
	if (!fromParsed.dim) return { error: "Invalid source unit." };
	const toParsed = parseUnits(toUnitExpression);
	if (toParsed.error) return { error: toParsed.error };
	if (!dimensionsEqual(fromParsed.dim, toParsed.dim))
		return { error: "Units are not dimensionally compatible." };

	// Offset units are converted through their absolute base value first, then the
	// target offset is subtracted after scaling back out.
	let baseValue = value * fromParsed.factor;
	if (fromParsed.offset) baseValue = (value + fromParsed.offset) * fromParsed.factor;

	let convertedValue = baseValue / toParsed.factor;
	if (toParsed.offset) convertedValue -= toParsed.offset;
	return { value: convertedValue };
}

export function tokenize(expression) {
	const input = cleanExpression(expression);
	const tokens = [];
	const numberPattern = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;

	let index = 0;
	while (index < input.length) {
		numberPattern.lastIndex = index;
		const prev = tokens[tokens.length - 1];
		const canTakeSignedNumber =
			// A leading sign belongs to the number only at expression starts or after
			// an operator/open parenthesis; elsewhere it is parsed as + or -.
			!prev || prev.type === "operator" || (prev.type === "paren" && prev.value === "(");

		const numberMatch = numberPattern.exec(input);
		if (numberMatch && (canTakeSignedNumber || !/^[-+]/.test(numberMatch[0]))) {
			tokens.push({ type: "number", value: numberMatch[0] });
			index = numberPattern.lastIndex;
			continue;
		}

		const unitMatch = scanUnitToken(input, index);
		if (unitMatch) {
			tokens.push({ type: "unit", value: input.slice(index, index + unitMatch.consumed) });
			index += unitMatch.consumed;
			continue;
		}

		const ch = input[index];
		if ("+-*/^".includes(ch)) {
			tokens.push({ type: "operator", value: ch });
			index++;
			continue;
		}
		if (ch === "(" || ch === ")") {
			tokens.push({ type: "paren", value: ch });
			index++;
			continue;
		}

		return {
			error: `I don't recognize "${input.slice(index, index + 8)}" as a unit or operator.`,
		};
	}

	return { tokens };
}

export function parseExpression(inputTokens) {
	// Recursive-descent parser that accepts numbers, units, *, /, ^ and unary +/-.
	if (!inputTokens) return { error: "Enter a value and units." };
	if (inputTokens.error) return { error: inputTokens.error };
	const tokens = Array.isArray(inputTokens) ? inputTokens : inputTokens.tokens;
	if (!Array.isArray(tokens)) return { error: "Enter a value and units." };
	if (!tokens.length) return { error: "Enter a value and units." };

	const state = { tokens, pos: 0 };

	const read = () => state.tokens[state.pos];
	const consume = () => state.tokens[state.pos++];

	const expect = (type, value) => {
		const tok = read();
		if (!tok || tok.type !== type || (value && tok.value !== value)) {
			state.error =
				value === ")" ? "Missing a closing parenthesis." : `Expected ${value || type} here.`;
			return null;
		}
		return consume();
	};

	const parsePrimary = () => {
		const tok = read();
		if (!tok) {
			state.error = "The expression stops early - finish the last term.";
			return null;
		}

		if (tok.type === "number") {
			consume();
			return { type: "number", value: Number(tok.value) };
		}
		if (tok.type === "unit") {
			consume();
			const parsedUnit = unitFromSymbol(tok.value);
			if (parsedUnit.error) {
				state.error = parsedUnit.error;
				return null;
			}
			return { type: "unit", symbol: tok.value, payload: parsedUnit.unit };
		}
		if (tok.type === "operator" && (tok.value === "+" || tok.value === "-")) {
			consume();
			const operand = parsePrimary();
			if (state.error) return null;
			return { type: "unary", op: tok.value, value: operand };
		}
		if (tok.type === "paren" && tok.value === "(") {
			consume();
			const inner = parseAddSub();
			if (state.error) return null;
			if (!expect("paren", ")")) return null;
			return { type: "group", value: inner };
		}

		state.error = `"${tok.value}" is not valid here.`;
		return null;
	};

	const parseExponent = () => {
		let base = parsePrimary();
		if (state.error) return null;

		while (read() && read().type === "operator" && read().value === "^") {
			consume();
			const exponent = parseExponent();
			if (state.error) return null;
			base = { type: "power", base, exponent };
		}
		return base;
	};

	const parseMulDiv = () => {
		let left = parseExponent();
		if (state.error) return null;

		while (
			read() &&
			(read().type === "operator"
				? read().value === "*" || read().value === "/"
				: read().type === "unit" || (read().type === "paren" && read().value === "("))
		) {
			const tok = read();
			const op = tok.type === "operator" ? consume().value : "*";
			const right = parseExponent();
			if (state.error) return null;
			left = { type: "binary", op, left, right };
		}
		return left;
	};

	const parseAddSub = () => {
		let left = parseMulDiv();
		if (state.error) return null;

		while (
			read() &&
			read().type === "operator" &&
			(read().value === "+" || read().value === "-")
		) {
			const op = consume().value;
			const right = parseMulDiv();
			if (state.error) return null;
			left = { type: "binary", op, left, right };
		}
		return left;
	};

	const ast = parseAddSub();
	if (state.error) return { error: state.error };
	if (state.pos !== state.tokens.length) {
		return { error: `"${read().value}" is not valid here.` };
	}
	return { ast };
}

export function evaluateAst(node) {
	if (!node) return { error: "No expression to evaluate." };

	const combine = (op, left, right) => {
		if (op === "+" || op === "-")
			return {
				error: "Addition and subtraction are not allowed in this answer.",
			};

		if (op === "*") {
			const leftOffset = left.unit.hasOffset;
			const rightOffset = right.unit.hasOffset;
			if (leftOffset || rightOffset) {
				if (leftOffset && rightOffset)
					return { error: "Offset units cannot be multiplied together." };
				const offsetSide = leftOffset ? left : right;
				const otherSide = leftOffset ? right : left;
				if (Object.keys(otherSide.unit.dim).length || otherSide.unit.hasOffset)
					return {
						error: "Offset units can only be scaled by pure numbers.",
					};
				return {
					value: left.value * right.value,
					unit: offsetSide.unit,
				};
			}
			return {
				value: left.value * right.value,
				unit: mulUnit(left.unit, right.unit),
			};
		}

		if (op === "/") {
			if (right.unit.hasOffset)
				return { error: "Offset units cannot be in the denominator." };
			if (left.unit.hasOffset) {
				if (Object.keys(right.unit.dim).length)
					return {
						error: "Offset units can only be divided by pure numbers.",
					};
				return {
					value: left.value / right.value,
					unit: left.unit,
				};
			}
			return {
				value: left.value / right.value,
				unit: divUnit(left.unit, right.unit),
			};
		}

		return { error: `Unsupported operator ${op}` };
	};

	switch (node.type) {
		case "number":
			return {
				value: node.value,
				unit: { factor: 1, dim: {}, hasOffset: false, offset: 0 },
			};
		case "unit":
			return { value: 1, unit: node.payload };
		case "unary": {
			const inner = evaluateAst(node.value);
			if (inner.error) return inner;
			return {
				value: node.op === "-" ? -inner.value : inner.value,
				unit: inner.unit,
			};
		}
		case "group":
			return evaluateAst(node.value);
		case "power": {
			const base = evaluateAst(node.base);
			if (base.error) return base;
			if (base.unit.hasOffset)
				return { error: "Offset units like Celsius cannot be exponentiated." };
			const exponent = evaluateAst(node.exponent);
			if (exponent.error) return exponent;
			if (Object.keys(exponent.unit.dim).length)
				return { error: "Units are not allowed in exponents." };
			if (!Number.isFinite(exponent.value)) return { error: "Invalid exponent." };
			if (!Number.isInteger(exponent.value))
				return { error: "Exponent must be an integer for units." };
			// Unit exponentiation is limited to integer powers so dimensions remain
			// integer vectors and generated answers stay classroom-friendly.
			return {
				value: Math.pow(base.value, exponent.value),
				unit: powUnit(base.unit, exponent.value),
			};
		}
		case "binary": {
			const left = evaluateAst(node.left);
			if (left.error) return left;
			const right = evaluateAst(node.right);
			if (right.error) return right;
			return combine(node.op, left, right);
		}
		default:
			return { error: `Unknown AST node type ${node.type}` };
	}
}

function sameUnitDefinition(a, b) {
	// Answers must use the requested target unit, not just any unit with the same
	// dimensions, so compare both dimensions and exact scale/offset identity.
	if (!a || !b) return false;
	if (!dimensionsEqual(a.dim, b.dim)) return false;
	if (a.hasOffset !== b.hasOffset) return false;
	if (a.hasOffset && a.offset !== b.offset) return false;
	// Compare scale factors with a relative tolerance: factors span a huge dynamic
	// range (e.g. ~1e17 for bar/nK), so an absolute epsilon would reject correct
	// answers whose factor differs only by floating-point rounding.
	const scale = Math.max(Math.abs(a.factor), Math.abs(b.factor));
	return Math.abs(a.factor - b.factor) <= 1e-9 * (scale || 1);
}

export function parseAnswer(rawInput, targetUnit) {
	// Validate the player's MathQuill response, enforcing that the final units match
	// the requested target and that the expression is dimensionally legal. Syntax
	// itself is settled by the shared pipeline, so a response the live preview
	// accepted can never be rejected here for a different reason.
	const analyzed = analyzeExpression(rawInput);
	if (analyzed.error) return { error: analyzed.error };

	const { value, unit } = analyzed;
	if (!Number.isFinite(value)) return { error: "Invalid numeric expression." };
	if (!Object.keys(unit.dim).length) return { error: "Units are required (e.g., m, kg, s)." };

	const target = parseUnits(targetUnit);
	if (target.error) return { error: target.error };

	if (!dimensionsEqual(unit.dim, target.dim))
		return { error: `Dimension mismatch. Expected units for ${targetUnit}` };

	if (!sameUnitDefinition(unit, target))
		return { error: `Answer must use the requested unit: ${targetUnit}` };

	return { value, unitObj: unit };
}

function cloneDim(dim) {
	return { ...dim };
}

function addDim(a, b, scale = 1) {
	// Shared helper for multiplying or dividing unit dimensions. Zero exponents
	// are deleted to keep later equality checks simple.
	const out = cloneDim(a);
	for (const k of Object.keys(b)) {
		out[k] = (out[k] || 0) + b[k] * scale;
		if (out[k] === 0) delete out[k];
	}
	return out;
}

function powUnit(unit, p) {
	return {
		factor: Math.pow(unit.factor, p),
		dim: Object.fromEntries(
			Object.entries(unit.dim)
				.map(([k, v]) => [k, v * p])
				.filter(([, v]) => v !== 0),
		),
		hasOffset: false,
		offset: 0,
	};
}

function mulUnit(u1, u2) {
	return {
		factor: u1.factor * u2.factor,
		dim: addDim(u1.dim, u2.dim, 1),
		hasOffset: false,
		offset: 0,
	};
}

function divUnit(u1, u2) {
	return {
		factor: u1.factor / u2.factor,
		dim: addDim(u1.dim, u2.dim, -1),
		hasOffset: false,
		offset: 0,
	};
}

function unitFromSymbol(symbol) {
	// Convert one token such as "km^2" into the unit object shape used by AST
	// evaluation: scale factor, dimension vector, and optional offset metadata.
	const r = new RegExp(`^${unitPattern}$`);
	const m = symbol.match(r);
	if (!m) return { error: `Invalid unit token: ${symbol}` };

	const [, prefixSymbol = "", base, rawExponent = ""] = m;
	const resolvedKey = resolveUnitKey(base);
	const def = NAMED_UNITS[resolvedKey];
	if (!def) return { error: `Unrecognized base unit: ${base}` };
	if (!(prefixSymbol in PREFIX_MULTIPLIERS))
		return { error: `Unrecognized prefix: ${prefixSymbol}` };
	if (prefixSymbol && def.allowPrefix === false)
		return { error: `Prefix not allowed for ${base}` };

	if (def.offset && rawExponent)
		return { error: "Offset units like Celsius cannot be exponentiated." };

	const exp = rawExponent ? parseInt(rawExponent.slice(1), 10) : 1;

	const prefixMul = PREFIX_MULTIPLIERS[prefixSymbol];
	const factor = Math.pow(def.factor * (def.allowPrefix === false ? 1 : prefixMul), exp);

	const dim = {};
	for (const [k, v] of Object.entries(def.dim)) dim[k] = v * exp;

	return {
		unit: { factor, dim, hasOffset: Boolean(def.offset), offset: def.offset || 0 },
	};
}

export const UNIT_TOKENS = ALL_UNIT_SYMBOLS.flatMap((baseUnit) => {
	const def = getUnitDefinition(baseUnit);
	const prefixedUnits =
		def?.allowPrefix === false
			? []
			: PREFIXES.filter(Boolean).map((prefixSymbol) => `${prefixSymbol}${baseUnit}`);
	return [baseUnit, ...prefixedUnits];
});

export const hasDimOverlapAcrossSides = memoizeByString((expression) => {
	// Generated questions avoid reducible forms where the same dimension appears
	// in numerator and denominator, even if the full expression is still valid.
	// Sides come from each term's net exponent, so this agrees with how the rest
	// of the app reads the expression.
	const { ast } = analyzeExpression(expression);
	if (!ast) return false;

	const numeratorDims = new Set();
	const denominatorDims = new Set();
	for (const term of collectUnitTerms(ast)) {
		const unit = NAMED_UNITS[term.key];
		if (!unit || term.exponent === 0) continue;
		const target = term.exponent < 0 ? denominatorDims : numeratorDims;
		for (const dimKey of Object.keys(unit.dim)) target.add(dimKey);
	}

	for (const dim of numeratorDims) if (denominatorDims.has(dim)) return true;
	return false;
});
