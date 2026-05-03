// Front-end controller for the metric conversions drill. Handles rendering a random
// conversion question, live-previewing typed units, parsing the MathQuill input,
// and validating the submitted answer.
import { toLatexUnits, toTooltipText } from "./parse-display.js";
import {
	cleanExpression,
	tokenize,
	parseAnswer,
	convertValue,
	UNIT_TOKENS,
	parseUnits,
} from "./parse.js";
import { buildQuestion } from "./buildQuestion.js";
import { NAMED_UNITS } from "./units.js";

let currentQuestion = null;

const setMessage = (text, cssClass = "") =>
	$("#msg").removeClass("err ok").addClass(cssClass).text(text);

const setPreview = (content, { asHtml = false, isError = false } = {}) => {
	const el = $("#preview");
	el.toggleClass("err", !!isError);
	if (!content) return el.text("");
	return asHtml ? el.html(content) : el.text(content);
};
const setAnswerTooltip = (text = "") => {
	const answer = $("#answerMQ");
	if (text) answer.attr("data-tooltip", text);
	else answer.removeAttr("data-tooltip");
};
const escapeAttr = (text) =>
	String(text)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

const colorLatex = (content) => `\\color[RGB]{97,97,194}{${content}}`;

const questionStems = [
	"Convert %AMOUNT% %FROM% to %TO%.",
	"Change %AMOUNT% %FROM% into %TO%.",
	"Express %AMOUNT% %FROM% in %TO%.",
	"Write %AMOUNT% %FROM% as %TO%.",
	"Give the equivalent of %AMOUNT% %FROM% in %TO%.",
	"What is %AMOUNT% %FROM% in %TO%?",
	"How many %TO% are in %AMOUNT% %FROM%?",
	"What is %AMOUNT% %FROM% expressed in %TO%?",
	"Translate %AMOUNT% %FROM% to %TO%.",
	"Re-express %AMOUNT% %FROM% using %TO%.",
	"Find the %TO% value corresponding to %AMOUNT% %FROM%.",
	"Compute the %TO% equivalent of %AMOUNT% %FROM%.",
	"Convert from %FROM% to %TO% for %AMOUNT%.",
	"If you start with %AMOUNT% %FROM%, what amount is that in %TO%?",
	"Determine the equivalent amount in %TO% for %AMOUNT% %FROM%.",
	"Evaluate %AMOUNT% %FROM% in terms of %TO%.",
	"Represent %AMOUNT% %FROM% in the unit %TO%.",
	"How much %TO% corresponds to %AMOUNT% %FROM%?",
	"What quantity in %TO% matches %AMOUNT% %FROM%?",
	"Convert the quantity %AMOUNT% %FROM% so it is measured in %TO%.",
	"Rewrite %AMOUNT% %FROM% so the result is in %TO%.",
	"Find the conversion result when %AMOUNT% %FROM% is expressed as %TO%.",
	"A measurement is recorded as %AMOUNT% %FROM% in a data table. What is the same quantity in %TO%?",
	"An instrument displays %AMOUNT% %FROM% on its readout. Convert this to %TO%.",
	"A value is listed as %AMOUNT% %FROM% in a specification sheet. Express it in %TO%.",
	"A result is reported as %AMOUNT% %FROM% in a report. What does this correspond to in %TO%?",
	"A technician notes %AMOUNT% %FROM% during a test. Rewrite the measurement in %TO%.",
	"A measurement taken in the field is %AMOUNT% %FROM%. Convert it into %TO%.",
	"A system logs a quantity as %AMOUNT% %FROM%. Determine the equivalent in %TO%.",
	"A calibration record shows %AMOUNT% %FROM%. Convert that value to %TO%.",
	"A dataset stores a quantity as %AMOUNT% %FROM%. What is the same quantity in %TO%?",
	"A sensor output is interpreted as %AMOUNT% %FROM%. Convert this reading to %TO%.",
	"A reference table gives %AMOUNT% %FROM%. Find the corresponding value in %TO%.",
	"A measurement is communicated as %AMOUNT% %FROM% between teams. Express it in %TO% for consistency.",
	"A value must be standardized: it is currently %AMOUNT% %FROM%. Convert it to %TO%.",
	"A quantity is provided in %FROM% as %AMOUNT%. Translate it to %TO% for comparison.",
	"A calculation requires the quantity in %TO%, but it is given as %AMOUNT% %FROM%. Convert it.",
	"For unit consistency in an analysis, %AMOUNT% %FROM% needs to be expressed in %TO%. What is the converted value?",
	"A measurement is written as %AMOUNT% %FROM% in one section of a document and needs to be in %TO% elsewhere. Convert it.",
	"A model input expects %TO%, yet the available measurement is %AMOUNT% %FROM%. Determine the equivalent in %TO%.",
	"A conversion step is required to align units: change %AMOUNT% %FROM% into %TO%.",
	"An equation uses %TO% units, but the given quantity is %AMOUNT% %FROM%. Convert it to %TO%.",
	"A specification is given as %AMOUNT% %FROM%, but a comparison requires %TO%. Convert the quantity.",
	"A measurement is expressed in %FROM% as %AMOUNT%. Restate it in %TO% to match the rest of the values.",
	"A document mixes units, and one entry is %AMOUNT% %FROM%. Convert that entry to %TO%.",
	"A value appears as %AMOUNT% %FROM% in a set of results. Re-express it in %TO%.",
	"A quantity is recorded as %AMOUNT% %FROM%, but the required unit is %TO%. What is the equivalent?",
	"A measurement is written as %AMOUNT% %FROM%. What is it in %TO%?",
	"A value is given as %AMOUNT% %FROM%. Convert it to %TO%.",
	"A quantity is recorded as %AMOUNT% %FROM%. Express the same quantity in %TO%.",
	"A reading shows %AMOUNT% %FROM%. What does that equal in %TO%?",
	"A measurement was taken in %FROM% and came out to %AMOUNT%. What is it in %TO%?",
	"A result is labeled %AMOUNT% %FROM%. Translate it to %TO%.",
	"A note lists %AMOUNT% %FROM%. Rewrite it in %TO%.",
	"A number is reported in %FROM% as %AMOUNT%. Change it to %TO%.",
	"A measurement uses %FROM%: %AMOUNT%. Convert to %TO%.",
	"A value appears as %AMOUNT% %FROM% in a table. Convert that entry to %TO%.",
	"Two sources use different units: one gives %AMOUNT% %FROM%. State the equivalent in %TO%.",
	"A quantity must be compared with others listed in %TO%, but it is %AMOUNT% %FROM%. Convert it.",
	"A calculation requires the value in %TO% even though it is provided as %AMOUNT% %FROM%. Convert it.",
	"A report standardizes everything to %TO%, but one line is %AMOUNT% %FROM%. Convert that line.",
	"A dataset mixes units; one record is %AMOUNT% %FROM%. Rewrite it in %TO%.",
	"A measurement is stored in %FROM% as %AMOUNT% but needs to be displayed in %TO%. Convert it.",
	"A chart axis is in %TO%, but a data point is listed as %AMOUNT% %FROM%. Convert the data point.",
	"A system expects %TO%, yet the available reading is %AMOUNT% %FROM%. Find the equivalent in %TO%.",
	"A reference value is provided as %AMOUNT% %FROM%. Convert it so it matches units of %TO%.",
	"A specification sheet lists %AMOUNT% %FROM%. Re-express it in %TO% for consistency.",
	"A conversion is needed before combining quantities: one term is %AMOUNT% %FROM%. Convert it to %TO%.",
	"Before substituting into an equation written in %TO%, convert the given %AMOUNT% %FROM% to %TO%.",
	"An analysis step requires the quantity in %TO% to avoid unit mismatch; it is currently %AMOUNT% %FROM%. Convert it.",
	"A cross-check uses %TO% units, but the recorded value is %AMOUNT% %FROM%. Determine the equivalent in %TO%.",
	"A workflow enforces %TO% as the canonical unit; an input arrives as %AMOUNT% %FROM%. Convert the input.",
	"A conversion must be applied prior to aggregation: translate %AMOUNT% %FROM% into %TO%.",
	"A unit-consistency check flags %AMOUNT% %FROM% because the model uses %TO%. Convert it to %TO%.",
	"A validation step compares values in %TO%, but one measurement is %AMOUNT% %FROM%. Convert it for the comparison.",
	"A pipeline requires all quantities in %TO%; one file contains %AMOUNT% %FROM%. Convert that value to %TO%.",
	"A result is correct only after unit alignment: convert %AMOUNT% %FROM% into %TO% so it can be used downstream.",
];

const pickStem = () => questionStems[Math.floor(Math.random() * questionStems.length)];
const fillStem = (stem, replacements) =>
	stem.replace(/%([A-Z]+)%/g, (m, key) => (key in replacements ? replacements[key] : m));

function updatePreview(answerField) {
	try {
		// Keep the answer tooltip in sync while the user types; bail out on parse issues.
		const raw = answerField.latex();
		const preview = $("#preview");
		preview.removeAttr("data-tooltip");
		if (!raw) {
			setPreview("");
			setAnswerTooltip("");
			return;
		}
		const cleaned = cleanExpression(raw);
		const tokens = tokenize(cleaned);
		if (tokens.error) {
			setPreview("Invalid input—check your syntax!", { isError: true });
			setAnswerTooltip("");
			return;
		}
		const list = tokens.tokens || [];
		let rebuilt = "";
		let prevType = null;
		for (const tok of list) {
			const isUnit = tok.type === "unit";
			const isOpenParen = tok.type === "paren" && tok.value === "(";
			const isCloseParen = tok.type === "paren" && tok.value === ")";
			const needsStar =
				(isUnit || isOpenParen) &&
				(prevType === "unit" || prevType === "number" || prevType === "closeParen");
			if (needsStar) rebuilt += "*";
			rebuilt += tok.value;
			prevType = isCloseParen ? "closeParen" : tok.type;
		}
		setPreview("");
		setAnswerTooltip(toTooltipText(rebuilt));
	} catch (e) {
		console.warn("Preview rendering failed", e);
		setPreview("Invalid input—check your syntax!", { isError: true });
		$("#preview").removeAttr("data-tooltip");
		setAnswerTooltip("");
	}
}

function refreshMath() {
	if (typeof MathJax === "undefined") return;
	if (typeof MathJax.typesetPromise === "function") MathJax.typesetPromise();
	else if (typeof MathJax.typeset === "function") MathJax.typeset();
}

function renderHint(fromExpr, toExpr) {
	const bases = new Set();
	[fromExpr, toExpr].forEach((expr) => {
		const parsed = parseUnits(expr);
		if (parsed?.bases) parsed.bases.forEach((b) => bases.add(b));
	});
	const hints = [];
	bases.forEach((base) => {
		const hint = NAMED_UNITS[base]?.hint;
		if (hint) hints.push(hint);
	});
	if (!hints.length) {
		$("#hint").html("");
		return;
	}
	const listItems = hints.map((hint) => `<li>${hint}</li>`).join("");
	$("#hint").html(`<ul>${listItems}</ul>`);
}

function renderQuestion(answerField) {
	currentQuestion = buildQuestion();

	const stemTemplate = pickStem();
	const latexFrom = `<span data-tooltip="${escapeAttr(toTooltipText(currentQuestion.fromUnit))}">\\(${colorLatex(toLatexUnits(currentQuestion.fromUnit))}\\)</span>`;
	const latexTo = `<span data-tooltip="${escapeAttr(toTooltipText(currentQuestion.toUnit))}">\\(${colorLatex(toLatexUnits(currentQuestion.toUnit))}\\)</span>`;
	const amountLatex = `\\(${currentQuestion.amountLatex || currentQuestion.amountDisplay || currentQuestion.amountValue || ""}\\)`;

	const latexStem = fillStem(stemTemplate, {
		AMOUNT: amountLatex,
		FROM: latexFrom,
		TO: latexTo,
	});

	$("#question").html(latexStem);
	renderHint(currentQuestion.fromUnit, currentQuestion.toUnit);
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

const focusAnswer = () => answerField.focus();

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

$(".control-btn").on("click", (e) => {
	const action = $(e.currentTarget).data("action");
	switch (action) {
		case "left":
			answerField.keystroke("Left");
			break;
		case "right":
			answerField.keystroke("Right");
			break;
		case "backspace":
			answerField.keystroke("Backspace");
			break;
		case "fraction":
			answerField.cmd("\\frac");
			break;
		case "exponent":
			answerField.cmd("^");
			break;
		default:
			break;
	}
	focusAnswer();
	updatePreview(answerField);
});

renderQuestion(answerField);
