/* ---------------------------------------------------------------------------
   Apple Pencil ink layer

   Pencil input is intercepted at the window's capture phase, so it never
   reaches the title letters or the project links, and is drawn onto the
   #ink-layer canvas instead — the way Scribble inks over a field: the line
   grows under the tip with pressure- and speed-varying width, and the ink then
   holds for a beat once the pen goes quiet and fades itself away. The hold
   belongs to the batch rather than to each stroke, so a scribble made of a
   dozen lines stays whole while it is being drawn and leaves all at once
   instead of dissolving from the oldest end. Ink that has started to fade is
   past recall: drawing again brings in fresh ink at full strength over the
   top and lets the old batch finish going. Fingers and mice are untouched.

   A stroke belongs to the pen, not to whatever is under the tip: on the first
   contact the gesture is pinned to <html> with pointer capture, and none of
   the events that fire because the pen wandered over something else — the
   boundary events, the cancel WebKit sends when it wants the gesture for a
   selection or a link drag — are allowed to end it. That is what lets a line
   started on blank background keep drawing across the title and the links.
   --------------------------------------------------------------------------- */
const INK = {
	rgb: "250, 235, 215", // antiquewhite, matching the page type
	minWidth: 1.4,
	maxWidth: 6,
	holdMs: 600, // full-strength dwell once the pen stops drawing
	fadeMs: 500,
	idleMs: 1200, // an open stroke this long without a sample is assumed gone
	maxStrokes: 24, // oldest strokes are dropped past this
	maxPoints: 1200, // per stroke, so a marathon scribble stays cheap to redraw
};

// Contact rather than hover. A Pencil on the glass reports the primary button
// down and a pressure above zero; either alone is enough, since iPadOS has
// been stingy with one or the other across versions.
const isPenDown = (event) => (event.buttons & 1) !== 0 || event.pressure > 0;

function initPencilInk() {
	// Input filtering stays active even when reduced motion or an unavailable
	// canvas disables drawing. Same-window capture listeners still receive the
	// events, so the drawing handlers below can consume the pen samples.
	const capture = (type, handler) =>
		window.addEventListener(type, handler, { capture: true, passive: false });

	for (const type of [
		"pointerdown",
		"pointermove",
		"pointerup",
		"pointercancel",
		"pointerout",
		"pointerleave",
		"pointerenter",
		"pointerover",
		"click",
		"auxclick",
		"contextmenu",
	]) {
		capture(type, (event) => {
			if (!isPenPointer(event)) return;
			event.preventDefault();
			event.stopPropagation();
		});
	}

	// Safari delivers a touch stream alongside pointer events. Cancel only
	// stylus touches so finger scrolling and pinch zoom retain their defaults.
	for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
		capture(type, (event) => {
			if (!Array.prototype.some.call(event.changedTouches, isStylusTouch)) return;
			event.preventDefault();
			event.stopPropagation();
		});
	}

	// The ink trail is a decorative flourish, not essential to using a link —
	// skip it under reduced motion instead of animating the hold/fade regardless.
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	const canvas = document.getElementById("ink-layer");
	if (!canvas) return;

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const strokes = [];
	let active = null; // { pointerId, stroke }
	let lastEnded = null; // { pointerId, stroke } — what a revive would pick up
	let frameId = null;
	// When ink was last laid down, or a stroke last closed. One clock with two
	// jobs: the whole layer holds at full strength until holdMs past it, and an
	// open stroke that gets no further than idleMs past it is assumed abandoned.
	let lastActivity = 0;
	let inkDirty = false; // held ink has changed since the canvas was painted
	// The batch that has been cut loose and is on its way out: { at, strokes },
	// where at is when its fade began. Its pixels live on the scratch canvas and
	// never change again, and nothing new joins it — a line drawn during the fade
	// is held ink, and does not drag this batch back up to full with it.
	let fading = null;
	let cssWidth = 0;
	let cssHeight = 0;

	// A stroke is drawn as a chain of separately-stroked segments (each with its
	// own width), so painting them at a fade alpha would stack transparency at
	// every joint — and everywhere two strokes cross — and flash as visible dots
	// and seams on the way out. Fading ink is therefore painted fully opaque onto
	// this scratch canvas and composited onto the real canvas in one drawImage at
	// the batch's current alpha. Held ink is opaque anyway and needs none of it.
	const scratch = document.createElement("canvas");
	const scratchCtx = scratch.getContext("2d");

	const sizeCanvas = () => {
		const ratio = window.devicePixelRatio || 1;
		cssWidth = window.innerWidth;
		cssHeight = window.innerHeight;
		canvas.width = Math.round(cssWidth * ratio);
		canvas.height = Math.round(cssHeight * ratio);
		scratch.width = canvas.width;
		scratch.height = canvas.height;
		inkDirty = true; // resizing a canvas clears it
		// Draw in CSS pixels; the transform handles the Retina scale-up.
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		scratchCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
		scratchCtx.lineCap = "round";
		scratchCtx.lineJoin = "round";
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

		stroke.points.push({
			x,
			y,
			t: time,
			w: widthFor(pressure, speed, last && last.w),
		});
		if (stroke.points.length > INK.maxPoints) stroke.points.shift();
		inkDirty = true;
	};

	// Ink is either held at full strength or on its way out; only the batch on
	// its way out has an alpha, and it runs from where its fade began rather
	// than from anything the pen does afterwards.
	const fadeAlpha = (now) => 1 - Math.min((now - fading.at) / INK.fadeMs, 1);

	const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	// Painted fully opaque (never at the fade alpha) so overlapping segments at
	// each joint don't stack transparency into visible dots — the layer is
	// composited onto the real canvas afterward at a single uniform alpha.
	// Points are joined midpoint-to-midpoint through a quadratic so the sampled
	// path reads as a smooth curve.
	const paintStroke = (target, points) => {
		if (points.length === 1) {
			target.fillStyle = `rgba(${INK.rgb}, 1)`;
			target.beginPath();
			target.arc(points[0].x, points[0].y, points[0].w / 2, 0, Math.PI * 2);
			target.fill();
			return;
		}

		target.strokeStyle = `rgba(${INK.rgb}, 1)`;
		for (let i = 1; i < points.length; i++) {
			const previous = points[i - 1];
			const current = points[i];
			const from = i === 1 ? previous : midpoint(points[i - 2], previous);
			const to = i === points.length - 1 ? current : midpoint(previous, current);

			target.lineWidth = (previous.w + current.w) / 2;
			target.beginPath();
			target.moveTo(from.x, from.y);
			target.quadraticCurveTo(previous.x, previous.y, to.x, to.y);
			target.stroke();
		}
	};

	// The fading batch is drawn once and then only re-composited, so each frame
	// of a fade costs one drawImage instead of every segment on screen again.
	// Rebuilt from its strokes when the scratch canvas is resized out from under
	// it, which is the one thing that can lose the bitmap.
	const paintFadingBitmap = () => {
		scratchCtx.clearRect(0, 0, cssWidth, cssHeight);
		for (const stroke of fading.strokes) paintStroke(scratchCtx, stroke.points);
	};

	// The hold has run out: everything on screen is cut loose to fade together,
	// which leaves the held batch empty for whatever is drawn next.
	const releaseInk = () => {
		// Only ever one batch on its way out at a time: the caller waits for any
		// fade already running, so a bitmap is never overwritten out from under
		// ink that is still visible. With holdMs at or above fadeMs the previous
		// batch has always finished by now and that wait costs nothing; set the
		// other way round, held ink simply keeps its full strength a little
		// longer, which is better than having its tail cut off.
		fading = { at: lastActivity + INK.holdMs, strokes: strokes.slice() };
		paintFadingBitmap();
		strokes.length = 0;
		lastEnded = null; // nothing held is left for a revive to pick up
	};

	const render = (now) => {
		ctx.clearRect(0, 0, cssWidth, cssHeight);

		if (fading !== null) {
			const alpha = fadeAlpha(now);
			if (alpha <= 0) {
				fading = null;
			} else {
				ctx.globalAlpha = alpha;
				ctx.drawImage(scratch, 0, 0, cssWidth, cssHeight);
				ctx.globalAlpha = 1;
			}
		}

		// Held ink is fully opaque, so it goes straight onto the canvas over the
		// top: no fade alpha, nothing for the joints to stack up.
		for (const stroke of strokes) paintStroke(ctx, stroke.points);
		inkDirty = false;
	};

	// The loop only runs while there is ink on screen. It is also where the hold
	// runs out, and where a stroke whose end never arrived — the pen crossing out
	// of the window, say, which no pointerup follows — is closed, since otherwise
	// it would hold at full strength forever. A revive undoes that if the pen
	// turns out to still be down.
	const tick = () => {
		const now = performance.now();
		if (active !== null && now - lastActivity > INK.idleMs) endStroke();
		if (
			active === null &&
			fading === null &&
			strokes.length &&
			now - lastActivity > INK.holdMs
		) {
			releaseInk();
		}

		// Held ink that has not changed is already on the canvas exactly as it
		// should be; only a fade needs the picture redrawn every frame.
		if (inkDirty || fading !== null) render(now);
		frameId = strokes.length || fading !== null ? requestAnimationFrame(tick) : null;
	};
	const startLoop = () => {
		if (frameId === null) frameId = requestAnimationFrame(tick);
	};

	const beginStroke = (event) => {
		const now = performance.now();
		const stroke = { points: [] };
		addPoint(stroke, event.clientX, event.clientY, event.pressure, now);
		strokes.push(stroke);
		while (strokes.length > INK.maxStrokes) strokes.shift();
		active = { pointerId: event.pointerId, stroke };
		lastActivity = now;
		lastEnded = null; // a fresh press is a new mark, never a continuation

		// Pin the rest of the gesture to <html>. Left uncaptured, the pointer
		// stays bound to whatever the press landed on, so crossing into a link or
		// a title letter re-aims the stream mid-stroke and drags the boundary and
		// cancel events along with it. <html> is the one element on the page that
		// nothing here re-renders, so the capture cannot be pulled back out.
		try {
			document.documentElement.setPointerCapture(event.pointerId);
		} catch {
			// A pointer WebKit already considers stale; the handlers below cope.
		}
		startLoop();
	};

	// A stroke closed early — a cancelled pointer, or the watchdog firing while
	// the tip rested — is picked back up if the same pen turns out to still be
	// down, so the interruption never shows as a break in the line. Only while
	// the layer is still inside its hold: past that the line has begun to go, and
	// carrying on from where it left off would look like a repair.
	const reviveStroke = (event) => {
		if (!lastEnded || event.pointerId !== lastEnded.pointerId) return false;

		const now = performance.now();
		if (now - lastActivity > INK.holdMs) return false;
		if (!strokes.includes(lastEnded.stroke)) return false; // already aged out

		active = { pointerId: event.pointerId, stroke: lastEnded.stroke };
		lastActivity = now;
		lastEnded = null;
		return true;
	};

	const extendStroke = (event) => {
		// Coalesced events carry the samples the browser batched between frames,
		// which is most of what makes a Pencil line look continuous.
		const samples =
			typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const now = performance.now();
		lastActivity = now;

		for (const sample of samples.length ? samples : [event]) {
			addPoint(active.stroke, sample.clientX, sample.clientY, sample.pressure, now);
		}
		startLoop();
	};

	const endStroke = () => {
		if (!active) return;
		lastEnded = { pointerId: active.pointerId, stroke: active.stroke };
		active = null;
		lastActivity = performance.now(); // the hold runs from the lift, not the last sample
		startLoop();
	};

	window.addEventListener("resize", () => {
		sizeCanvas();
		if (fading !== null) paintFadingBitmap();
		render(performance.now());
	});

	capture("pointerdown", (event) => {
		if (!isPenPointer(event)) return;
		event.preventDefault();
		event.stopPropagation();
		beginStroke(event);
	});

	capture("pointermove", (event) => {
		if (!isPenPointer(event)) return;
		event.stopPropagation();

		const isMine = active !== null && event.pointerId === active.pointerId;

		// Pencil hover — tip near the glass, no contact — moves the pointer around
		// without drawing, and once a stroke has been cancelled it is the only sign
		// the pen ever came up, since nothing follows a cancel.
		if (!isPenDown(event)) {
			if (isMine) endStroke();
			return;
		}

		if (active !== null && !isMine) return; // a second pen; one line is enough

		event.preventDefault();

		// Drawing with nothing open: either the stroke was closed early and this is
		// the same pen carrying on, or the press itself never reached us. The tip is
		// on the glass either way, so it gets ink — continued if the line it left
		// off is still there, freshly started if it is not.
		if (!isMine && !reviveStroke(event)) {
			beginStroke(event); // records this sample itself
			return;
		}

		extendStroke(event);
	});

	capture("pointerup", (event) => {
		if (!isPenPointer(event)) return;
		event.stopPropagation();
		if (active && event.pointerId === active.pointerId) endStroke();
	});

	// Cancel and boundary events are filtered above without ending the stroke.
	// If samples stop, the hover check or idle watchdog closes it.

	sizeCanvas();
}

document.addEventListener("DOMContentLoaded", () => {
	initPencilInk();
});
