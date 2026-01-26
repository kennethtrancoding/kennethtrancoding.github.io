// Front-end controller for the metric conversions drill. Handles rendering a random
// conversion question, live-previewing typed units, parsing the MathQuill input,
// and validating the submitted answer.
import {
	cleanExpression,
	tokenize,
	toPlainUnits,
	toLatexUnits,
	parseAnswer,
	convertValue,
	UNIT_TOKENS,
} from "./parse.js";
import { buildQuestion } from "./buildQuestion.js";

let currentQuestion = null;

const setMessage = (text, cssClass = "") =>
	$("#msg").removeClass("err ok").addClass(cssClass).text(text);

const plainUnitOptions = {
	pluralizeNumerator: true,
	singularizeDenominator: true,
};
const UNIT_ACCENT_COLOR = "#6161c2";
const colorLatex = (content) => `\\color{${UNIT_ACCENT_COLOR}}{${content}}`;

const questionStems = [
	"Convert %AMOUNT% %FROM% to %TO%.",
	"How many %TO% are in %AMOUNT% %FROM%?",
	"What is %AMOUNT% %FROM% expressed in %TO%?",
	"Change %AMOUNT% %FROM% into %TO%.",
	"Please convert %AMOUNT% %FROM% into %TO%.",
	"Translate %AMOUNT% %FROM% to %TO%.",
	"Calculate the equivalent of %AMOUNT% %FROM% in %TO%.",
	"What's the %TO% value for %AMOUNT% %FROM%?",
	"Express %AMOUNT% %FROM% as %TO%.",
	"Convert an amount of %AMOUNT% %FROM% to %TO%.",
	"I have %AMOUNT% %FROM%—how much is that in %TO%?",
	"Turn %AMOUNT% %FROM% into %TO% units.",
	"Give me %AMOUNT% %FROM% in %TO%.",
	"How do I represent %AMOUNT% %FROM% using %TO%?",
	"Find the %TO% equivalent for %AMOUNT% %FROM%.",
	"What does %AMOUNT% %FROM% become in %TO%?",
	"If I start with %AMOUNT% %FROM%, what is that in %TO%?",
	"Re-express %AMOUNT% %FROM% in %TO%.",
	"Convert from %FROM% to %TO%: %AMOUNT%.",
	"Compute %AMOUNT% %FROM% → %TO%.",
	"How much %TO% corresponds to %AMOUNT% %FROM%?",
	"What's %AMOUNT% %FROM% when measured in %TO%?",
	"Provide the conversion of %AMOUNT% %FROM% into %TO%.",
	"I need %AMOUNT% %FROM% converted to %TO%.",
];

const pickStem = () => questionStems[Math.floor(Math.random() * questionStems.length)];
const fillStem = (stem, replacements) =>
	stem.replace(/%([A-Z]+)%/g, (m, key) => (key in replacements ? replacements[key] : m));

function updatePreview(answerField) {
	try {
		// Show a human-friendly unit string while the user types; bail out on any parse issues.
		const raw = answerField.latex();
		if (!raw) return $("#preview").text("");
		const cleaned = cleanExpression(raw);
		const tokens = tokenize(cleaned);
		if (tokens.error) return $("#preview").text("");
		const list = tokens.tokens || [];
		let rebuilt = "";
		let prevType = null;
		for (const tok of list) {
			const isUnit = tok.type === "unit";
			const isNumber = tok.type === "number";
			const isOpenParen = tok.type === "paren" && tok.value === "(";
			const isCloseParen = tok.type === "paren" && tok.value === ")";
			const needsStar =
				(isUnit || isOpenParen) &&
				(prevType === "unit" || prevType === "number" || prevType === "closeParen");
			if (needsStar) rebuilt += "*";
			rebuilt += tok.value;
			prevType = isCloseParen ? "closeParen" : tok.type;
		}
		const coloredPlain = toPlainUnits(rebuilt, {
			...plainUnitOptions,
			wrapUnitsWith: (text) => `<span class="unit-accent">${text}</span>`,
		});
		const spaced = coloredPlain
			.replace(/\*/g, " * ")
			.replace(/([0-9)])(?=<span)/g, "$1 ")
			.replace(/([0-9)])(?=[A-Za-zµ])/g, "$1 ")
			.replace(/\s+/g, " ")
			.trim();
		$("#preview").html(spaced);
	} catch (e) {
		console.warn("Preview rendering failed", e);
		$("#preview").text("");
	}
}

function refreshMath() {
	if (typeof MathJax === "undefined") return;
	if (typeof MathJax.typesetPromise === "function") MathJax.typesetPromise();
	else if (typeof MathJax.typeset === "function") MathJax.typeset();
}

function renderQuestion(answerField) {
	currentQuestion = buildQuestion();

	// Render LaTeX and plain-English versions of the prompt using a shared stem.
	const stemTemplate = pickStem();
	const formatPlainUnits = (expr) =>
		toPlainUnits(expr, plainUnitOptions)
			.replace(/\*/g, " * ")
			.replace(/\s+/g, " ")
			.trim();
	const plainFrom = formatPlainUnits(currentQuestion.fromUnit);
	const plainTo = formatPlainUnits(currentQuestion.toUnit);
	const latexAmount = `\\(${colorLatex(currentQuestion.amount)}\\)`;
	const latexFrom = `\\(${colorLatex(toLatexUnits(currentQuestion.fromUnit))}\\)`;
	const latexTo = `\\(${colorLatex(toLatexUnits(currentQuestion.toUnit))}\\)`;

	const latexStem = fillStem(stemTemplate, {
		AMOUNT: latexAmount,
		FROM: latexFrom,
		TO: latexTo,
	});
	const plainStem = fillStem(stemTemplate, {
		AMOUNT: `<strong>${currentQuestion.amount}</strong>`,
		FROM: `<strong>${plainFrom}</strong>`,
		TO: `<strong>${plainTo}</strong>`,
	});

	$("#question").html(latexStem);
	$("#full").html(plainStem);
	setMessage("");
	answerField.latex("");
	updatePreview(answerField);
	refreshMath();
}

const mathQuillInterface = MathQuill.getInterface(2);
const answerField = mathQuillInterface.MathField(document.getElementById("answerMQ"), {
	// Let multi-letter unit symbols be typed without spaces.
	autoOperatorNames: UNIT_TOKENS.filter((t) => t.length >= 2)
		.map((t) => t.replace("µ", "u"))
		.join(" "),
	handlers: {
		edit: () => {
			setMessage("");
			updatePreview(answerField);
		},
	},
});

$(document).on("keydown", "#answerMQ textarea", function (e) {
	if (e.key === "+" || e.key === "\\" || e.key === "_" || e.key === "=") {
		e.preventDefault();
		return false;
	}
});
$(document).on("paste", "#answerMQ textarea", function (e) {
	e.preventDefault();
});

$("#submit").on("click", () => {
	// Parse the MathQuill input, force the requested unit, then compare with a small tolerance.
	const answer = parseAnswer(answerField.latex(), currentQuestion.toUnit);
	if (answer.error) return setMessage(answer.error, "err");

	const converted = convertValue(answer.value, answer.unitObj, currentQuestion.toUnit);

	if (converted.error) return setMessage(converted.error, "err");

	const tolerance = Math.max(1e-12, Math.abs(currentQuestion.expected) * 0.005);
	const isCorrect = Math.abs(converted.value - currentQuestion.expected) <= tolerance;
	setMessage(
		isCorrect
			? "Correct!"
			: `Incorrect—expected ≈ ${currentQuestion.expected.toPrecision(6)} ${currentQuestion.toUnit}.`,
		isCorrect ? "ok" : "err",
	);
});

$("#next").on("click", () => renderQuestion(answerField));
renderQuestion(answerField);
