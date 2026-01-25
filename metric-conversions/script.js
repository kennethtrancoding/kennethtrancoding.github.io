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
		const plain = toPlainUnits(rebuilt);
		const withoutParens = plain.replace(/[()]/g, "");
		const spaced = withoutParens
			.replace(/([0-9)])(?=[A-Za-zµ])/g, "$1 ")
			.replace(/\s+/g, " ")
			.trim();
		$("#preview").text(spaced);
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

	// Render LaTeX and plain-English versions of the prompt.
	$("#question").html(
		`Convert \\(${currentQuestion.amount}\\,${toLatexUnits(currentQuestion.fromUnit)}\\) to \\(${toLatexUnits(currentQuestion.toUnit)}\\).`,
	);
	const plainFrom = toPlainUnits(currentQuestion.fromUnit);
	const plainTo = toPlainUnits(currentQuestion.toUnit);
	$("#full").html(
		`Convert <strong>${currentQuestion.amount} ${plainFrom}</strong> to <strong>${plainTo}</strong>.`,
	);
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
