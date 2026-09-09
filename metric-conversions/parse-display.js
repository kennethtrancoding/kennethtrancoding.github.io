// Rendering helpers for displaying unit expressions in LaTeX or plain text.
// Relies on core parsing utilities from parse.js but avoids evaluation logic.
import { PREFIX_NAMES } from "./units.js";
import {
	analyzeExpression,
	collectUnitTerms,
	mergeUnitTerms,
	scanUnitToken,
	getUnitDefinition,
} from "./parse.js";

// Display entry points accept either raw input or an analysis that a caller has
// already run, so nothing re-parses the same text twice or reaches a different
// verdict about it than the grading path did.
const toAnalysis = (input) =>
	typeof input === "string" || input == null ? analyzeExpression(input) : input;

const pluralizeUnitName = (name, unitDef) => {
	// Unit metadata wins over generic English rules for irregular or invariant
	// names such as hertz, siemens, and degrees Celsius.
	if (unitDef?.plural) return unitDef.plural;
	if (unitDef?.invariantPlural) return name;
	if (name.startsWith("degree ")) return name.replace("degree ", "degrees ");
	if (name.endsWith("y")) return `${name.slice(0, -1)}ies`;
	if (name.endsWith("s")) return name;
	return `${name}s`;
};

const singularizeUnitName = (name) => name;

export function toLatexUnits(input) {
	// Render from the shared term list rather than re-splitting the text on "/".
	// The old split treated everything after the first slash as denominator, which
	// disagreed with the left-associative grammar the rest of the app uses.
	const analyzed = toAnalysis(input);
	if (!analyzed.ast) return latexFallback(analyzed.cleaned ?? "");

	const terms = mergeUnitTerms(collectUnitTerms(analyzed.ast));
	if (!terms.length) return latexFallback(analyzed.cleaned ?? "");

	const render = (term, exponent) =>
		`\\mathrm{${term.prefix}${term.key}}${exponent === 1 ? "" : `^{${exponent}}`}`;
	const numerator = terms.filter((t) => t.exponent > 0).map((t) => render(t, t.exponent));
	const denominator = terms.filter((t) => t.exponent < 0).map((t) => render(t, -t.exponent));

	if (!denominator.length) return numerator.join("\\,");
	return `\\frac{${numerator.join("\\,") || "1"}}{${denominator.join("\\,")}}`;
}

function latexFallback(cleaned) {
	// Partial or unparseable text still needs to render something readable, so
	// scan whatever unit symbols it does contain.
	let out = "";
	let cursor = 0;
	while (cursor < cleaned.length) {
		if (cleaned[cursor] === "*") {
			out += "\\,";
			cursor++;
			continue;
		}
		const token = scanUnitToken(cleaned, cursor);
		if (!token) {
			out += cleaned.slice(cursor).replace(/\*/g, "\\,");
			break;
		}
		const exponent = token.rawExponent ? `^{${token.rawExponent.slice(1)}}` : "";
		out += `\\mathrm{${token.prefix}${token.base}}${exponent}`;
		cursor += token.consumed;
	}
	return out || cleaned;
}

export function toPlainUnits(input, options = {}) {
	const {
		pluralizeNumerator = false,
		singularizeDenominator = false,
		wrapFractions = true,
		wrapUnitsWith = null,
	} = options;
	const analyzed = toAnalysis(input);
	const cleaned = analyzed.cleaned ?? "";
	const collapseSpaces = (text) => text.replace(/\s+/g, " ").trim();
	const wrapBalanced = (s) => {
		// Parenthesize numerator/denominator groups unless they are already one
		// balanced group, which keeps plain text unambiguous without double wraps.
		if (!wrapFractions) return s;
		if (!s) return "";
		if (!(s.startsWith("(") && s.endsWith(")"))) return `(${s})`;
		let depth = 0;
		for (let idx = 0; idx < s.length; idx++) {
			const ch = s[idx];
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
			if (depth === 0 && idx < s.length - 1) return `(${s})`;
		}
		if (depth !== 0) return `(${s})`;
		return s;
	};
	let encounteredUnsupportedOp = false;

	const formatUnitSymbol = (symbol, isDenominator = false) => {
		const token = scanUnitToken(symbol, 0);
		if (!token) return symbol;
		const prefixSymbol = token.prefix;
		const base = token.base;
		const rawExponent = token.rawExponent;
		const prefixText = PREFIX_NAMES[prefixSymbol] || prefixSymbol;
		const unitDef = getUnitDefinition(base);
		const baseName = unitDef?.name || base;
		let adjustedName = baseName;
		if (!isDenominator && pluralizeNumerator)
			adjustedName = pluralizeUnitName(baseName, unitDef);
		else if (isDenominator && singularizeDenominator)
			adjustedName = singularizeUnitName(baseName);
		const expo = rawExponent ? `^${rawExponent.slice(1)}` : "";
		let piece = `${prefixText ? `${prefixText}` : ""}${adjustedName}${expo}`.trim();
		if (typeof wrapUnitsWith === "function") piece = wrapUnitsWith(piece);
		return piece;
	};
	const formatTokensLoosely = (tokenList = []) => {
		// Fallback formatter for partial or unsupported expressions. It preserves
		// user-entered operators while still expanding known unit names.
		if (!Array.isArray(tokenList) || !tokenList.length) return collapseSpaces(cleaned);
		let rebuilt = "";
		let prevType = null;
		for (const tok of tokenList) {
			const isUnit = tok.type === "unit";
			const isNumber = tok.type === "number";
			const isOpenParen = tok.type === "paren" && tok.value === "(";
			const isCloseParen = tok.type === "paren" && tok.value === ")";
			const needsStar =
				(isUnit || isOpenParen || isNumber) &&
				(prevType === "unit" || prevType === "number" || prevType === "closeParen");
			if (needsStar) rebuilt += " * ";
			if (isUnit) rebuilt += formatUnitSymbol(tok.value, false);
			else rebuilt += tok.value;
			prevType = isCloseParen ? "closeParen" : tok.type;
		}
		return collapseSpaces(rebuilt);
	};
	// Evaluation failures (a "+" between units, say) still leave a usable AST, so
	// only a missing parse forces the loose token rendering.
	const fallbackPerFormat = () =>
		analyzed.tokens ? formatTokensLoosely(analyzed.tokens) : collapseSpaces(cleaned);
	if (!analyzed.ast) return fallbackPerFormat();
	const parsed = { ast: analyzed.ast };

	const wrap = wrapBalanced;
	const unwrapGroup = (node) => {
		// Formatting does not need to preserve parser-only grouping nodes once
		// precedence has already been captured in the AST.
		let current = node;
		while (current?.type === "group") current = current.value;
		return current || node;
	};
	const isCompositeNode = (node) => {
		const target = unwrapGroup(node);
		return target?.type === "binary" || target?.type === "unary";
	};

	const formatFactor = (node, inDenominator = false) => {
		if (!node) return "";
		switch (node.type) {
			case "number":
				return `${node.value}`;
			case "unit":
				return formatUnitSymbol(node.symbol, inDenominator);
			case "unary":
				return `${node.op}${formatFactor(node.value, inDenominator)}`;
			case "group":
				return formatFactor(node.value, inDenominator);
			case "power": {
				const base = formatFactor(node.base, inDenominator);
				const exponent = formatFactor(node.exponent, false);
				const wrappedBase = isCompositeNode(node.base) ? `(${base})` : base;
				const wrappedExponent = isCompositeNode(node.exponent) ? `(${exponent})` : exponent;
				return `${wrappedBase}^${wrappedExponent}`;
			}
			case "binary":
				if (node.op !== "*" && node.op !== "/") {
					// Addition/subtraction are parser-valid but not useful in unit
					// display text, so fall back to the loose token rendering.
					encounteredUnsupportedOp = true;
					return "";
				}
				if (node.op === "/") {
					const left = wrapBalanced(formatFactor(node.left, inDenominator));
					const right = wrapBalanced(
						formatFactor(node.right, node.op === "/" ? !inDenominator : inDenominator),
					);
					return `${left}/${right}`;
				}
				return collapseSpaces(
					`${formatFactor(node.left, inDenominator)} * ${formatFactor(
						node.right,
						inDenominator,
					)}`,
				);
			default:
				return "";
		}
	};

	const collectMultiplicative = (
		node,
		inDenominator = false,
		acc = { numerator: [], denominator: [] },
	) => {
		// Flatten products and divisions into numerator/denominator buckets so
		// text reads as "m * s / kg" instead of mirroring AST nesting.
		if (!node) return acc;
		const target = unwrapGroup(node);
		if (target.type === "binary" && (target.op === "*" || target.op === "/")) {
			collectMultiplicative(target.left, inDenominator, acc);
			collectMultiplicative(
				target.right,
				target.op === "/" ? !inDenominator : inDenominator,
				acc,
			);
			return acc;
		}
		const rendered = formatFactor(target, inDenominator);
		if (rendered) (inDenominator ? acc.denominator : acc.numerator).push(rendered);
		return acc;
	};

	const formatNode = (node, inDenominator = false) => {
		const { numerator, denominator } = collectMultiplicative(node, inDenominator);
		const left = collapseSpaces(numerator.join(" * "));
		const right = collapseSpaces(denominator.join(" * "));
		if (!right) return collapseSpaces(left);
		const wrappedLeft = wrap(left || "1");
		const wrappedRight = wrap(right || "1");
		return collapseSpaces(`${wrappedLeft}/${wrappedRight}`);
	};

	const rendered = collapseSpaces(formatNode(parsed.ast));
	if (encounteredUnsupportedOp) return fallbackPerFormat();
	return rendered || fallbackPerFormat();
}

export function toTooltipText(input) {
	const analyzed = toAnalysis(input);
	const cleaned = analyzed.cleaned ?? "";
	if (!analyzed.ast) return cleaned;
	const parsed = { ast: analyzed.ast };

	const unwrap = (node) => {
		let n = node;
		while (n?.type === "group") n = n.value;
		return n || node;
	};

	const numer = [];
	const denom = [];

	const exponentText = (value) => {
		if (!value) return "";
		const n = unwrap(value);
		if (n?.type === "number") return `^${n.value}`;
		return "";
	};
	const collect = (node, inDenom = false, inheritedExponent = "") => {
		// Tooltip text ignores numeric factors, but keeps unit exponents visible
		// so symbols such as min^2 do not collapse to just "minutes".
		const n = unwrap(node);
		if (!n) return;
		switch (n.type) {
			case "binary":
				collect(n.left, inDenom, inheritedExponent);
				collect(n.right, n.op === "/" ? !inDenom : inDenom, inheritedExponent);
				break;
			case "unary":
				collect(n.value, inDenom, inheritedExponent);
				break;
			case "power":
				collect(n.base, inDenom, `${inheritedExponent}${exponentText(n.exponent)}`);
				break;
			case "unit": {
				const token = scanUnitToken(n.symbol, 0);
				if (!token) return;
				const prefixName = PREFIX_NAMES[token.prefix] || token.prefix;
				const unitDef = getUnitDefinition(token.base);
				const baseName = unitDef?.name || token.base;
				const name = inDenom ? baseName : pluralizeUnitName(baseName, unitDef);
				const unitExponent = token.rawExponent
					? `^${token.rawExponent.slice(1)}`
					: inheritedExponent;
				(inDenom ? denom : numer).push(`${prefixName}${name}${unitExponent}`.trim());
				break;
			}
			default:
				break;
		}
	};

	collect(parsed.ast);
	if (!numer.length) return cleaned;
	return denom.length ? `${numer.join(" ")} per ${denom.join(" ")}` : numer.join(" ");
}
