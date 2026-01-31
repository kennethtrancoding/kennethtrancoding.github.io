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
			const wrappedNumer = wrapArg(numer);
			const wrappedDenom = wrapArg(denom);
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

export function cleanExpression(expression) {
	const fractionNormalized = expandFractions(expression);
	const output = normalizeMicro(fractionNormalized.trim())
		.replace(/\\+left|\\+right/g, "")
		.replace(/\\+times/g, "*")
		.replace(/\\+cdot/g, "*")
		.replace(/\u00b7/g, "*")
		.replace(/\\+,/g, "")
		.replace(/\\+ /g, "*")
		.replace(/\*+/g, "*")
		.replace(/\s+/g, "")
		.replace(/\\operatorname\{([^}]+)\}/g, "$1")
		.replace(/\^\{(-?\d+)\}/g, "^$1")
		.replace(/{/g, "(")
		.replace(/}/g, ")")
		.replace(/\\/g, "");
	return output;
}

export function dimensionsEqual(dimensionA, dimensionB) {
	const keys = new Set([...Object.keys(dimensionA), ...Object.keys(dimensionB)]);
	for (const key of keys) if ((dimensionA[key] || 0) !== (dimensionB[key] || 0)) return false;
	return true;
}

const prefixPattern = PREFIXES.filter(Boolean)
	.sort((a, b) => b.length - a.length)
	.join("|");
const unitPattern = `(${prefixPattern}|)(${ALL_UNIT_SYMBOLS.join("|")})(\\^-?\\d+)?`;
const unitRegex = () => new RegExp(unitPattern, "g");
const exponentRegex = /^\^-?\d+/;

const matchUnitAt = (text, startIndex) => {
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
	const unitMatch = matchUnitAt(text, startIndex);
	if (!unitMatch) return null;
	const exponentMatch = exponentRegex.exec(text.slice(startIndex + unitMatch.length));
	const rawExponent = exponentMatch ? exponentMatch[0] : "";
	const consumed = unitMatch.length + rawExponent.length;
	return { ...unitMatch, rawExponent, consumed };
};

export function parseUnits(expression) {
	// Normalize a unit expression (prefixes, exponents, numerator/denominator) into
	// a canonical form and compute its dimension + scale factor.
	const sanitized = cleanExpression(expression);
	if (!sanitized) return { error: "Units required." };

	let factor = 1;
	const dimension = {};
	const normalizedParts = [];
	const parts = sanitized.split("/");
	let hasOffsetUnit = false;
	let offsetToBase = 0;
	const baseUnitsUsed = new Set();

	for (const [index, part] of parts.entries()) {
		const sign = index ? -1 : 1;
		const segments = part
			.split("*")
			.map((s) => s.replace(/[()]/g, ""))
			.filter(Boolean);
		if (!segments.length) return { error: "Invalid unit syntax." };

		const normalizedSegments = [];
		for (const segment of segments) {
			let cursor = 0;
			while (cursor < segment.length) {
				const token = scanUnitToken(segment, cursor);
				if (!token || token.consumed === 0)
					return { error: `Invalid unit syntax near "${segment.slice(cursor)}"` };

				const { prefix: prefixSymbol, base, rawExponent } = token;
				const resolvedKey = resolveUnitKey(base);
				const unit = NAMED_UNITS[resolvedKey];
				if (!unit) return { error: `Unrecognized base unit: ${base}` };
				if (!(prefixSymbol in PREFIX_MULTIPLIERS))
					return { error: `Unrecognized prefix: ${prefixSymbol}` };
				if (prefixSymbol && unit.allowPrefix === false)
					return { error: `Prefix not allowed for ${base}` };

				const exponent = (rawExponent ? parseInt(rawExponent.slice(1), 10) : 1) * sign;

				if (unit.offset) {
					if (parts.length > 1 || segments.length > 1 || exponent !== 1 || sign === -1)
						return {
							error: "Offset units like Celsius cannot be combined, divided, or exponentiated.",
						};
					if (hasOffsetUnit && resolvedKey !== "degC")
						return {
							error: "Only one offset unit can be used in an expression.",
						};
					hasOffsetUnit = true;
					offsetToBase = unit.offset;
				}
				const prefixMultiplier = PREFIX_MULTIPLIERS[prefixSymbol];
				const normalizedPrefix =
					unit.allowPrefix === false && prefixSymbol ? "" : prefixSymbol;

				factor *= Math.pow(unit.factor * prefixMultiplier, exponent);
				baseUnitsUsed.add(resolvedKey);

				for (const [dimensionKey, value] of Object.entries(unit.dim)) {
					dimension[dimensionKey] = (dimension[dimensionKey] || 0) + value * exponent;
					if (!dimension[dimensionKey]) delete dimension[dimensionKey];
				}
				normalizedSegments.push(`${normalizedPrefix}${resolvedKey}${rawExponent || ""}`);
				cursor += token.consumed;
			}
		}
		const combined = normalizedSegments.join("*");
		normalizedParts.push(index ? `/${combined}` : combined);
	}
	return {
		factor,
		dim: dimension,
		normalized: normalizedParts.join(""),
		hasOffset: hasOffsetUnit,
		offset: offsetToBase,
		bases: [...baseUnitsUsed],
	};
}
export function convertValue(value, fromUnit, toUnitExpression) {
	const fromParsed = typeof fromUnit === "string" ? parseUnits(fromUnit) : fromUnit;
	if (!fromParsed || fromParsed.error)
		return { error: fromParsed?.error || "Invalid source unit." };
	if (!fromParsed.dim) return { error: "Invalid source unit." };
	const toParsed = parseUnits(toUnitExpression);
	if (toParsed.error) return { error: toParsed.error };
	if (!dimensionsEqual(fromParsed.dim, toParsed.dim))
		return { error: "Units are not dimensionally compatible." };

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

		return { error: `Unexpected token near "${input.slice(index, index + 8)}"` };
	}

	return { tokens };
}

export function parseExpression(inputTokens) {
	// Recursive-descent parser that accepts numbers, units, *, /, ^ and unary +/-.
	if (!inputTokens) return { error: "No tokens provided" };
	if (inputTokens.error) return { error: inputTokens.error };
	const tokens = Array.isArray(inputTokens) ? inputTokens : inputTokens.tokens;
	if (!Array.isArray(tokens)) return { error: "Tokens must be an array" };
	if (!tokens.length) return { error: "Unexpected end of input" };

	const state = { tokens, pos: 0 };

	const read = () => state.tokens[state.pos];
	const consume = () => state.tokens[state.pos++];

	const expect = (type, value) => {
		const tok = read();
		if (!tok || tok.type !== type || (value && tok.value !== value)) {
			state.error = `Expected ${value || type} at position ${state.pos}`;
			return null;
		}
		return consume();
	};

	const parsePrimary = () => {
		const tok = read();
		if (!tok) {
			state.error = "Unexpected end of input";
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

		state.error = `Unexpected token ${tok.value} at position ${state.pos}`;
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
		return { error: `Unexpected token ${read().value} at position ${state.pos}` };
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
	if (!a || !b) return false;
	if (!dimensionsEqual(a.dim, b.dim)) return false;
	if (a.hasOffset !== b.hasOffset) return false;
	if (a.hasOffset && a.offset !== b.offset) return false;
	return Math.abs(a.factor - b.factor) < 1e-12;
}

export function parseAnswer(rawInput, targetUnit) {
	// Validate the player's MathQuill response, enforcing that the final units match
	// the requested target and that the expression is dimensionally legal.
	const normalizedInput = rawInput.replace(/\s+/g, " ").trim();
	if (!normalizedInput) return { error: "Please enter a value and units." };

	try {
		const cleaned = cleanExpression(normalizedInput);
		const tokens = tokenize(cleaned);
		if (tokens.error) return { error: tokens.error };
		const parsed = parseExpression(tokens);
		if (parsed.error) return { error: parsed.error };
		const evaluated = evaluateAst(parsed.ast);
		if (evaluated.error) return { error: evaluated.error };

		if (!Number.isFinite(evaluated.value)) return { error: "Invalid numeric expression." };
		if (!Object.keys(evaluated.unit.dim).length)
			return { error: "Units are required (e.g., m, kg, s)." };

		const target = parseUnits(targetUnit);
		if (target.error) return { error: target.error };

		if (!dimensionsEqual(evaluated.unit.dim, target.dim)) {
			return {
				error: `Dimension mismatch. Expected units for ${targetUnit}`,
			};
		}

		if (!sameUnitDefinition(evaluated.unit, target)) {
			return {
				error: `Answer must use the requested unit: ${targetUnit}`,
			};
		}

		return { value: evaluated.value, unitObj: evaluated.unit };
	} catch (e) {
		console.error("Failed to parse answer:", e);
		return { error: "Could not parse expression. Check your syntax." };
	}
}

function cloneDim(dim) {
	return { ...dim };
}

function addDim(a, b, scale = 1) {
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

function isUnitSymbol(symbol) {
	const r = new RegExp(`^${unitPattern}$`);
	return r.test(symbol);
}

function unitFromSymbol(symbol) {
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

function separateValueAndUnitObj(node) {
	if (node.isSymbolNode && isUnitSymbol(node.name)) {
		const parsed = unitFromSymbol(node.name);
		if (parsed.error) return { error: parsed.error };
		return { valueNode: new math.ConstantNode(1), unit: parsed.unit };
	}

	if (node.isConstantNode) {
		return {
			valueNode: node,
			unit: { factor: 1, dim: {}, hasOffset: false, offset: 0 },
		};
	}

	if (node.isParenthesisNode) {
		const inner = separateValueAndUnitObj(node.content);
		if (inner.error) return inner;
		return {
			valueNode: new math.ParenthesisNode(inner.valueNode),
			unit: inner.unit,
		};
	}

	if (node.isOperatorNode) {
		const left = separateValueAndUnitObj(node.args[0]);
		if (left.error) return left;

		const right = node.args[1] ? separateValueAndUnitObj(node.args[1]) : null;
		if (right && right.error) return right;

		if ((node.op === "+" || node.op === "-") && node.args.length === 1) {
			const newValueNode = new math.OperatorNode(node.op, node.fn, [left.valueNode]);
			return { valueNode: newValueNode, unit: left.unit };
		}

		if (node.op === "*" || node.op === "/") {
			const leftOffset = left.unit.hasOffset;
			const rightOffset = right && right.unit.hasOffset;

			if (node.op === "*") {
				if (leftOffset || rightOffset) {
					if (leftOffset && rightOffset)
						return { error: "Offset units cannot be multiplied together." };
					const offsetSide = leftOffset ? left : right;
					const otherSide = leftOffset ? right : left;
					if (Object.keys(otherSide.unit.dim).length || otherSide.unit.hasOffset)
						return {
							error: "Offset units can only be scaled by pure numbers.",
						};
					const newValueNode = new math.OperatorNode(node.op, node.fn, [
						left.valueNode,
						right.valueNode,
					]);
					return { valueNode: newValueNode, unit: offsetSide.unit };
				}
			}

			if (node.op === "/") {
				if (rightOffset) return { error: "Offset units cannot be in the denominator." };
				if (leftOffset) {
					if (Object.keys(right.unit.dim).length)
						return {
							error: "Offset units can only be divided by pure numbers.",
						};
					const newValueNode = new math.OperatorNode(node.op, node.fn, [
						left.valueNode,
						right.valueNode,
					]);
					return { valueNode: newValueNode, unit: left.unit };
				}
			}
			const newValueNode = new math.OperatorNode(node.op, node.fn, [
				left.valueNode,
				right.valueNode,
			]);
			const newUnit =
				node.op === "*" ? mulUnit(left.unit, right.unit) : divUnit(left.unit, right.unit);
			return { valueNode: newValueNode, unit: newUnit };
		}

		if (node.op === "^") {
			if (left.unit.hasOffset)
				return { error: "Offset units like Celsius cannot be exponentiated." };
			if (right.unit && Object.keys(right.unit.dim).length) {
				return { error: "Units are not allowed in exponents." };
			}

			const expVal = right.valueNode.compile().evaluate();
			if (!Number.isFinite(expVal)) return { error: "Invalid exponent." };
			if (!Number.isInteger(expVal))
				return { error: "Exponent must be an integer for units." };

			const newValueNode = new math.OperatorNode(node.op, node.fn, [
				left.valueNode,
				right.valueNode,
			]);
			return { valueNode: newValueNode, unit: powUnit(left.unit, expVal) };
		}

		return { error: "Addition and subtraction are not allowed in this answer." };
	}

	return { valueNode: node, unit: { factor: 1, dim: {} } };
}

export const UNIT_TOKENS = ALL_UNIT_SYMBOLS.flatMap((baseUnit) => [
	baseUnit,
	...PREFIXES.filter(Boolean).map((prefixSymbol) => `${prefixSymbol}${baseUnit}`),
]);

export function hasDimOverlapAcrossSides(expression) {
	const sanitized = cleanExpression(expression);
	const numeratorDims = new Set();
	const denominatorDims = new Set();

	const parts = sanitized.split("/");
	for (const [index, part] of parts.entries()) {
		const target = index === 0 ? numeratorDims : denominatorDims;
		const segments = part
			.split("*")
			.map((s) => s.replace(/[()]/g, ""))
			.filter(Boolean);

		for (const segment of segments) {
			const regex = unitRegex();
			let match;
			while ((match = regex.exec(segment)) !== null) {
				const [, , base] = match;
				const unit = NAMED_UNITS[resolveUnitKey(base)];
				if (!unit) continue;
				Object.keys(unit.dim).forEach((dimKey) => target.add(dimKey));
			}
		}
	}

	for (const dim of numeratorDims) if (denominatorDims.has(dim)) return true;
	return false;
}
