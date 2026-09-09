// Feature flag: 3D tilt-and-recoil on the project links. Set to false to fall
// back to the flat scale-down/burst animation.
const TILT_ENABLED = false;
const TILT_DEGREES = 16;
const PRESS_DEPTH = 22;

// Feature flag: how the title letters magnify on hover. true scales them with
// transforms, so the headline keeps its layout and the page holds still. Set to
// false for the original font-size growth, which spreads the line out for real
// — and reflows the page on every hover as a result.
const STATIC_TITLE_HOVER = true;

// Apple Pencil is explicitly not a pointing device on this page. Pen input
// never hovers, presses, or follows a link — initPencilInk() swallows it at the
// window's capture phase and paints it onto the ink overlay instead. These two
// predicates are the single definition of "that was the Pencil": pointer events
// label it pointerType "pen", and iOS touch events label it touchType "stylus".
const isPenPointer = (event) => event.pointerType === "pen";
const isStylusTouch = (touch) => !!touch && touch.touchType === "stylus";

document.documentElement.classList.toggle("tilt", TILT_ENABLED);
document.documentElement.classList.toggle("static-title", STATIC_TITLE_HOVER);

document.addEventListener("DOMContentLoaded", () => {
	initPencilInk();

	let autoSpan = "";

	for (let letter of $("#title").text().split("")) {
		autoSpan += `<span class="title-letter" data-original="${letter}">${letter}</span>`;
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
	////////////////////////////////

	const wrappers = document.querySelectorAll(".underline");
	if (!wrappers.length) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const clampToEdge = (value) => Math.max(-1, Math.min(1, value));

	// Positive rotateY tips the right edge away from the viewer, positive rotateX
	// tips the bottom edge toward it, so the clicked point is what sinks inward.
	const pressTransform = (link, event) => {
		const rect = link.getBoundingClientRect();
		const nx = clampToEdge(((event.clientX - rect.left) / rect.width) * 2 - 1);
		const ny = clampToEdge(((event.clientY - rect.top) / rect.height) * 2 - 1);
		return `perspective(700px) rotateX(${(-ny * TILT_DEGREES).toFixed(2)}deg) rotateY(${(
			nx * TILT_DEGREES
		).toFixed(2)}deg) translateZ(${-PRESS_DEPTH}px)`;
	};

	let shrinkTimeoutId = null;
	const resetLinks = () => {
		document.querySelectorAll(".underline [data-ref]").forEach((link) => {
			const wrapper = link.closest(".underline");
			if (!wrapper) return;
			const originalHTML = link.dataset.originalHtml;
			if (originalHTML) link.innerHTML = originalHTML;
			link.classList.remove("is-active", "is-post-click");
			link.style.transform = "";
			wrapper.classList.remove("is-hovered");
		});
	};

	wrappers.forEach((wrapper) => {
		const link = wrapper.querySelector("[data-ref]");
		if (!link) return;

		link.dataset.originalHtml = link.innerHTML;

		const clearWrapperStates = () => {
			wrapper.classList.remove("is-hovered");
		};

		const recoil = () => {
			link.classList.remove("is-active");
			link.classList.add("is-post-click");
			link.style.transform = "";
		};

		wrapper.classList.remove("is-hovered");
		link.classList.remove("is-active", "is-post-click");

		wrapper.addEventListener("pointerenter", (e) => {
			if (isPenPointer(e)) return;
			wrapper.classList.add("is-hovered");
		});
		wrapper.addEventListener("pointerleave", (e) => {
			if (isPenPointer(e)) return;
			clearWrapperStates();
			if (TILT_ENABLED) {
				if (link.classList.contains("is-active")) recoil();
			} else {
				link.classList.remove("is-active");
			}
		});

		link.addEventListener("pointerdown", (e) => {
			if (isPenPointer(e)) return;
			link.classList.remove("is-post-click");
			link.classList.add("is-active");
			if (!TILT_ENABLED || reduceMotion.matches) return;
			link.style.transform = pressTransform(link, e);
		});

		// A touch that turns into a scroll cancels the pointer instead of firing
		// pointerup, so release the press state here or it stays stuck.
		link.addEventListener("pointercancel", (e) => {
			if (isPenPointer(e)) return;
			clearWrapperStates();
			recoil();
		});

		link.addEventListener("pointerup", (e) => {
			if (isPenPointer(e)) return;
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

			e.preventDefault();
			recoil();

			const href = link.dataset.ref;
			setTimeout(() => {
				link.innerHTML = "Taking you there...";
			}, 75);

			setTimeout(() => {
				link.innerHTML = link.dataset.originalHtml || link.innerHTML;
				window.location.href = href;
			}, 500);
		});
	});

	window.addEventListener("pageshow", (event) => {
		if (event.persisted) {
			resetLinks();
		}
	});
});

/* ---------------------------------------------------------------------------
   Apple Pencil ink layer

   Pencil input is intercepted at the window's capture phase, so it never
   reaches the title letters or the project links, and is drawn onto the
   #ink-layer canvas instead — the way Scribble inks over a field: the line
   grows under the tip with pressure- and speed-varying width, holds for a beat
   after the pen lifts, then fades itself away. Fingers and mice are untouched.
   --------------------------------------------------------------------------- */
const INK = {
	rgb: "250, 235, 215", // antiquewhite, matching the page type
	minWidth: 1.4,
	maxWidth: 6,
	holdMs: 600, // full-strength dwell after the pen lifts
	fadeMs: 700,
	maxStrokes: 24, // oldest strokes are dropped past this
	maxPoints: 1200, // per stroke, so a marathon scribble stays cheap to redraw
};

function initPencilInk() {
	const canvas = document.getElementById("ink-layer");
	if (!canvas) return;

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const strokes = [];
	let active = null; // { pointerId, stroke }
	let frameId = null;
	let cssWidth = 0;
	let cssHeight = 0;

	const sizeCanvas = () => {
		const ratio = window.devicePixelRatio || 1;
		cssWidth = window.innerWidth;
		cssHeight = window.innerHeight;
		canvas.width = Math.round(cssWidth * ratio);
		canvas.height = Math.round(cssHeight * ratio);
		// Draw in CSS pixels; the transform handles the Retina scale-up.
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
	};

	// Pencil pressure is 0..1; speed thins the line the way a real nib does.
	const widthFor = (pressure, speed, previousWidth) => {
		const hasPressure = pressure > 0 && pressure < 1;
		const weight = hasPressure ? Math.pow(pressure, 0.55) : 0.6;
		const speedTaper = 1 - Math.min(speed / 2.5, 1) * 0.5;
		const target = INK.minWidth + (INK.maxWidth - INK.minWidth) * weight * speedTaper;
		// Blend with the previous width so the stroke does not visibly step.
		return previousWidth == null ? target : previousWidth * 0.6 + target * 0.4;
	};

	const addPoint = (stroke, x, y, pressure, time) => {
		const last = stroke.points[stroke.points.length - 1];
		let speed = 0;

		if (last) {
			const distance = Math.hypot(x - last.x, y - last.y);
			if (distance < 0.5) return; // ignore nib jitter while the pen rests
			speed = distance / Math.max(time - last.t, 1);
		}

		stroke.points.push({ x, y, t: time, w: widthFor(pressure, speed, last && last.w) });
		if (stroke.points.length > INK.maxPoints) stroke.points.shift();
	};

	const alphaFor = (stroke, now) => {
		if (stroke.endedAt === null) return 1;
		const age = now - stroke.endedAt;
		if (age <= INK.holdMs) return 1;
		return 1 - Math.min((age - INK.holdMs) / INK.fadeMs, 1);
	};

	const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	// Two passes: a wide, faint one for the same glow the headline letters have,
	// then the ink itself. Points are joined midpoint-to-midpoint through a
	// quadratic so the sampled path reads as a smooth curve.
	const drawStroke = (stroke, alpha) => {
		const points = stroke.points;

		if (points.length === 1) {
			ctx.fillStyle = `rgba(${INK.rgb}, ${alpha})`;
			ctx.beginPath();
			ctx.arc(points[0].x, points[0].y, points[0].w / 2, 0, Math.PI * 2);
			ctx.fill();
			return;
		}

		for (const pass of [
			{ scale: 2.4, alpha: alpha * 0.14 },
			{ scale: 1, alpha },
		]) {
			ctx.strokeStyle = `rgba(${INK.rgb}, ${pass.alpha})`;
			for (let i = 1; i < points.length; i++) {
				const previous = points[i - 1];
				const current = points[i];
				const from = i === 1 ? previous : midpoint(points[i - 2], previous);
				const to = i === points.length - 1 ? current : midpoint(previous, current);

				ctx.lineWidth = ((previous.w + current.w) / 2) * pass.scale;
				ctx.beginPath();
				ctx.moveTo(from.x, from.y);
				ctx.quadraticCurveTo(previous.x, previous.y, to.x, to.y);
				ctx.stroke();
			}
		}
	};

	const render = () => {
		const now = performance.now();
		ctx.clearRect(0, 0, cssWidth, cssHeight);

		for (let i = strokes.length - 1; i >= 0; i--) {
			const alpha = alphaFor(strokes[i], now);
			if (alpha <= 0) {
				strokes.splice(i, 1);
				continue;
			}
			drawStroke(strokes[i], alpha);
		}
	};

	// The loop only runs while there is ink on screen.
	const tick = () => {
		render();
		frameId = strokes.length ? requestAnimationFrame(tick) : null;
	};
	const startLoop = () => {
		if (frameId === null) frameId = requestAnimationFrame(tick);
	};

	const beginStroke = (event) => {
		const stroke = { points: [], endedAt: null };
		addPoint(stroke, event.clientX, event.clientY, event.pressure, performance.now());
		strokes.push(stroke);
		while (strokes.length > INK.maxStrokes) strokes.shift();
		active = { pointerId: event.pointerId, stroke };
		startLoop();
	};

	const extendStroke = (event) => {
		// Coalesced events carry the samples the browser batched between frames,
		// which is most of what makes a Pencil line look continuous.
		const samples =
			typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const now = performance.now();

		for (const sample of samples.length ? samples : [event]) {
			addPoint(active.stroke, sample.clientX, sample.clientY, sample.pressure, now);
		}
		startLoop();
	};

	const endStroke = () => {
		if (!active) return;
		active.stroke.endedAt = performance.now();
		active = null;
		startLoop();
	};

	window.addEventListener("resize", () => {
		sizeCanvas();
		render();
	});

	// Capture phase, so pen events are consumed before the page's own pointer
	// handlers ever see them. stopPropagation() does not affect other listeners
	// on window itself, so these still cooperate with each other.
	const capture = (type, handler) =>
		window.addEventListener(type, handler, { capture: true, passive: false });

	capture("pointerdown", (event) => {
		if (!isPenPointer(event)) return;
		event.preventDefault();
		event.stopPropagation();
		beginStroke(event);
	});

	capture("pointermove", (event) => {
		if (!isPenPointer(event)) return;
		event.stopPropagation();
		// Pencil hover (tip near the glass, no contact) reports no button down.
		if (!active || event.pointerId !== active.pointerId) return;
		event.preventDefault();
		extendStroke(event);
	});

	for (const type of ["pointerup", "pointercancel", "pointerleave", "pointerout"]) {
		capture(type, (event) => {
			if (!isPenPointer(event)) return;
			event.stopPropagation();
			if (active && event.pointerId === active.pointerId) endStroke();
		});
	}

	for (const type of ["pointerenter", "pointerover"]) {
		capture(type, (event) => {
			if (isPenPointer(event)) event.stopPropagation();
		});
	}

	// Safari still delivers touch events alongside pointer events, and it is the
	// touch stream that scrolls the page — so a stylus touch has to be cancelled
	// here or the page slides around under the stroke. Finger touches fall
	// through untouched and keep scrolling normally.
	for (const type of ["touchstart", "touchmove", "touchend"]) {
		capture(type, (event) => {
			if (!Array.prototype.some.call(event.changedTouches, isStylusTouch)) return;
			event.preventDefault();
			event.stopPropagation();
		});
	}

	sizeCanvas();
}
