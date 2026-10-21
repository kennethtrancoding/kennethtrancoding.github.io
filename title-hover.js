// Feature flag: how the title letters magnify on hover. true scales them with
// transforms, so the headline keeps its layout and the page holds still. Set to
// false for the original font-size growth, which spreads the line out for real
// — and reflows the page on every hover as a result.
const STATIC_TITLE_HOVER = true;

document.documentElement.classList.toggle("static-title", STATIC_TITLE_HOVER);

document.addEventListener("DOMContentLoaded", () => {
	let autoSpan = "";
	const titleText = $("#title").text();

	// The full name goes on the h1 itself; each letter span is aria-hidden so a
	// screen reader announces it once instead of once per letter.
	$("#title").attr("aria-label", titleText);

	for (let letter of titleText.split("")) {
		autoSpan += `<span class="title-letter" data-original="${letter}" aria-hidden="true">${letter}</span>`;
	}
	$("#title").html(autoSpan);

	const letters = $("#title").children();

	// Under STATIC_TITLE_HOVER the magnified letters are scaled, not resized, so
	// they take up no more layout space than they did at rest. Push every letter
	// sideways by the width its scaled-up predecessors on the same line would
	// have added, which reproduces the spread-apart look of the font-size
	// version without reflowing the page. The font-size version needs none of
	// this — the line spreads itself.
	function applyLetterShifts() {
		if (!STATIC_TITLE_HOVER) return;

		const metrics = letters.toArray().map((element) => ({
			element,
			top: element.offsetTop,
			width: element.offsetWidth,
			scale: parseFloat(getComputedStyle(element).getPropertyValue("--s")) || 1,
		}));

		let shift = 0;
		let lineTop = null;

		for (const { element, top, width, scale } of metrics) {
			// A wrapped headline starts each line back at the left edge.
			if (top !== lineTop) {
				lineTop = top;
				shift = 0;
			}
			element.style.setProperty("--x", `${shift.toFixed(2)}px`);
			shift += width * (scale - 1);
		}
	}

	function mouseOverEffect(selection) {
		const index = selection.index();

		letters.removeClass("is-main is-neighbor");
		selection.addClass("is-main");

		if (index + 1 < letters.length) {
			letters.eq(index + 1).addClass("is-neighbor");
		}
		if (index - 1 >= 0) {
			letters.eq(index - 1).addClass("is-neighbor");
		}

		applyLetterShifts();
	}

	$("#title > *").on("mouseenter", function () {
		mouseOverEffect($(this));
	});

	const clearLetters = () => {
		letters.removeClass("is-main is-neighbor");
		applyLetterShifts();
	};

	$("#title").on("mouseleave", function () {
		setTimeout(clearLetters, 100);
	});

	// Touch equivalent of the hover effect: mouseenter never fires on a phone,
	// so track which letter the finger is currently over and light that one up.
	const letterUnderTouch = (touch) => {
		const element = document.elementFromPoint(touch.clientX, touch.clientY);
		return element && element.classList.contains("title-letter") ? element : null;
	};

	$("#title").on("touchstart touchmove", function (event) {
		const touch = event.originalEvent.touches[0];
		if (!touch || isStylusTouch(touch)) return;

		const element = letterUnderTouch(touch);
		if (element) {
			mouseOverEffect($(element));
		} else {
			clearLetters();
		}
	});

	$("#title").on("touchend touchcancel", function () {
		setTimeout(clearLetters, 100);
	});
});
